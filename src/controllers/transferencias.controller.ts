import { type Request, type Response } from "express";
import { ObjectId, type Collection } from "mongodb";
import type { CuentaT } from "../models/cuentas.model.js";
import type { MovimientoT } from "../models/movimientos.model.js";
import { modulo97 } from "./cuentas.controller.js";

let cuentaCollection: Collection<CuentaT>;
let movimientoCollection: Collection<MovimientoT>;

export const configTransferenciaCollections = (
    cuentas: Collection<CuentaT>,
    movimientos: Collection<MovimientoT>
) => {
    cuentaCollection = cuentas;
    movimientoCollection = movimientos;
};

export const validarIBAN = (iban: string): boolean => {
    if (!iban || typeof iban !== "string") return false;
    const limpio = iban.trim().toUpperCase();
    if (!/^ES\d{22}$/.test(limpio)) return false;

    // Se mueven los 4 caracteres iniciales al final
    const reordenado = limpio.slice(4) + limpio.slice(0, 4);
    let transformado = "";
    for (const ch of reordenado) {
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90) {
            transformado += (code - 55).toString();
        } else {
            transformado += ch;
        }
    }
    return modulo97(transformado) === 1;
};

export const postTransferencia = (req: Request, res: Response) => {
    const { ibanOrigen, ibanDestino, importe, concepto, categoria } = req.body || {};

    if (!Number.isInteger(importe) || importe <= 0) {
        res.status(400).json({ error: "El importe debe ser un entero positivo en céntimos" });
        return;
    }

    if (!concepto || typeof concepto !== "string" || !concepto.trim()) {
        res.status(400).json({ error: "El concepto es obligatorio" });
        return;
    }

    if (!validarIBAN(ibanOrigen)) {
        res.status(400).json({ error: "El IBAN de origen no es válido" });
        return;
    }

    if (!validarIBAN(ibanDestino)) {
        res.status(400).json({ error: "El IBAN de destino no es válido" });
        return;
    }

    if (ibanOrigen === ibanDestino) {
        res.status(400).json({ error: "Las cuentas de origen y destino deben ser distintas" });
        return;
    }

    Promise.all([
        cuentaCollection.findOne({ iban: ibanOrigen }),
        cuentaCollection.findOne({ iban: ibanDestino })
    ]).then(([cuentaOrigen, cuentaDestino]) => {
        if (!cuentaOrigen) {
            res.status(404).json({ error: "Cuenta de origen no encontrada" });
            return;
        }

        if (!cuentaDestino) {
            res.status(404).json({ error: "Cuenta de destino no encontrada" });
            return;
        }

        if (cuentaOrigen.estado !== "activa") {
            res.status(409).json({ error: `La cuenta de origen no está activa (estado actual: ${cuentaOrigen.estado})` });
            return;
        }

        if (cuentaDestino.estado === "cerrada") {
            res.status(409).json({ error: "La cuenta de destino está cerrada" });
            return;
        }

        // Regla de comisión
        let comision = 0;
        const mismoCliente = cuentaOrigen.clienteId === cuentaDestino.clienteId;
        if (!mismoCliente) {
            const calculada = Math.ceil(importe * 0.005);
            comision = Math.max(100, calculada);
        }

        const cargoTotal = importe + comision;
        const saldoMinimoOrigen = -cuentaOrigen.descubiertoMax;
        const disponible = cuentaOrigen.saldo - saldoMinimoOrigen;

        if (cuentaOrigen.saldo - cargoTotal < saldoMinimoOrigen) {
            res.status(409).json({
                error: `Saldo insuficiente: disponible ${disponible} céntimos (incluido descubierto), solicitado ${cargoTotal}`
            });
            return;
        }

        const inicioDia = new Date();
        inicioDia.setHours(0, 0, 0, 0);

        return movimientoCollection.aggregate([
            {
                $match: {
                    cuentaId: cuentaOrigen._id!.toString(),
                    tipo: "transferencia_emitida",
                    fecha: { $gte: inicioDia.toISOString() }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$importe" }
                }
            }
        ]).toArray().then((resultado) => {
            const emitidoHoy = resultado[0]?.total ? Math.abs(Number(resultado[0].total)) : 0;

            if (emitidoHoy + importe > 100000) {
                res.status(409).json({
                    error: `Límite diario superado: ya ha transferido ${emitidoHoy} céntimos hoy. Límite máximo: 100000`
                });
                return;
            }

            const transferenciaId = new ObjectId().toString();
            const cat = categoria ? String(categoria).trim() : "otros";
            const conc = String(concepto).trim();
            const fecha = new Date().toISOString();

            const nuevoSaldoOrigen = cuentaOrigen.saldo - cargoTotal;
            const nuevoSaldoDestino = cuentaDestino.saldo + importe;

            // Actualización de cuentas
            return Promise.all([
                cuentaCollection.updateOne({ _id: cuentaOrigen._id }, { $set: { saldo: nuevoSaldoOrigen } }),
                cuentaCollection.updateOne({ _id: cuentaDestino._id }, { $set: { saldo: nuevoSaldoDestino } })
            ]).then(() => {
                const movimientos: MovimientoT[] = [
                    {
                        cuentaId: cuentaOrigen._id!.toString(),
                        tipo: "transferencia_emitida",
                        importe: -importe,
                        saldoResultante: cuentaOrigen.saldo - importe,
                        concepto: conc,
                        categoria: cat,
                        transferenciaId,
                        fecha
                    },
                    {
                        cuentaId: cuentaDestino._id!.toString(),
                        tipo: "transferencia_recibida",
                        importe,
                        saldoResultante: nuevoSaldoDestino,
                        concepto: conc,
                        categoria: cat,
                        transferenciaId,
                        fecha
                    }
                ];

                if (comision > 0) {
                    movimientos.push({
                        cuentaId: cuentaOrigen._id!.toString(),
                        tipo: "comision",
                        importe: -comision,
                        saldoResultante: nuevoSaldoOrigen,
                        concepto: `Comisión transferencia ${conc}`,
                        categoria: "comisiones",
                        transferenciaId,
                        fecha
                    });
                }

                return movimientoCollection.insertMany(movimientos).then(() => {
                    res.status(201).json({
                        transferenciaId,
                        importe,
                        comision,
                        saldoOrigen: nuevoSaldoOrigen,
                        ibanOrigen,
                        ibanDestino
                    });
                });
            });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al procesar la transferencia" });
    });
};