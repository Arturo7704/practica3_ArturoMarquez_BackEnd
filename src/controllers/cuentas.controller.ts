import { type Request, type Response } from "express";
import { ObjectId, type Collection } from "mongodb";
import type { CuentaT, EstadoCuenta } from "../models/cuentas.model.js";
import type { ClienteT } from "../models/clientes.model.js";
import type { MovimientoT } from "../models/movimientos.model.js";

let cuentaCollection: Collection<CuentaT>;
let clienteCollection: Collection<ClienteT>;
let movimientoCollection: Collection<MovimientoT>;

export const configCuentaCollections = (
    cuentas: Collection<CuentaT>,
    clientes: Collection<ClienteT>,
    movimientos: Collection<MovimientoT>
) => {
    cuentaCollection = cuentas;
    clienteCollection = clientes;
    movimientoCollection = movimientos;
};

export const modulo97 = (cadenaNumerica: string): number => {
    return Number(BigInt(cadenaNumerica) % 97n);
};

export const generarIBAN = (): string => {
    let bban = "";
    for (let i = 0; i < 20; i++) {
        bban += Math.floor(Math.random() * 10).toString();
    }
    const mod = modulo97(bban + "142800");
    const control = 98 - mod;
    const controlStr = control < 10 ? `0${control}` : `${control}`;
    return `ES${controlStr}${bban}`;
};

export const postCuenta = (req: Request, res: Response) => {
    const { clienteId, tipo } = req.body || {};

    if (!clienteId || !tipo) {
        res.status(400).json({ error: "clienteId y tipo son obligatorios" });
        return;
    }

    if (!ObjectId.isValid(clienteId)) {
        res.status(400).json({ error: "clienteId no es un ObjectId válido" });
        return;
    }

    if (!["corriente", "ahorro"].includes(tipo)) {
        res.status(400).json({ error: "El tipo de cuenta debe ser 'corriente' o 'ahorro'" });
        return;
    }

    clienteCollection.findOne({ _id: new ObjectId(clienteId) }).then((cliente) => {
        if (!cliente) {
            res.status(404).json({ error: "El cliente especificado no existe" });
            return;
        }

        return cuentaCollection.countDocuments({
            clienteId: clienteId.toString(),
            estado: { $ne: "cerrada" }
        }).then((cuentasActivas) => {
            if (cuentasActivas >= 3) {
                res.status(409).json({ error: "El cliente ya tiene 3 cuentas no cerradas" });
                return;
            }

            // Comprobación previa manual de colisión de IBAN
            const intentarGenerarEInsertar = (reintentos: number): Promise<any> => {
                const iban = generarIBAN();

                return cuentaCollection.findOne({ iban }).then((existeIBAN) => {
                    if (existeIBAN) {
                        if (reintentos > 0) {
                            return intentarGenerarEInsertar(reintentos - 1);
                        }
                        throw new Error("No se pudo generar un IBAN único");
                    }

                    const nuevaCuenta: CuentaT = {
                        iban,
                        clienteId: clienteId.toString(),
                        tipo,
                        saldo: 0,
                        descubiertoMax: tipo === "corriente" ? 50000 : 0,
                        estado: "activa",
                        creadaEn: new Date().toISOString()
                    };

                    return cuentaCollection.insertOne(nuevaCuenta).then((resInsert) => {
                        return {
                            _id: resInsert.insertedId.toString(),
                            ...nuevaCuenta
                        };
                    });
                });
            };

            return intentarGenerarEInsertar(5).then((creada) => {
                res.status(201).json(creada);
            });
        });
    }).catch((err: any) => {
        res.status(500).json({ error: err.message || "Error al crear la cuenta" });
    });
};

export const getCuentas = (req: Request, res: Response) => {
    const { clienteId, tipo, estado } = req.query;
    const pagina = Math.max(1, parseInt(req.query.pagina as string) || 1);
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite as string) || 20));
    const skip = (pagina - 1) * limite;

    const filtro: Record<string, any> = {};
    if (clienteId) {
        if (!ObjectId.isValid(clienteId as string)) {
            res.status(400).json({ error: "clienteId no es un ObjectId válido" });
            return;
        }
        filtro.clienteId = clienteId;
    }
    if (tipo) filtro.tipo = tipo;
    if (estado) filtro.estado = estado;

    Promise.all([
        cuentaCollection.find(filtro).skip(skip).limit(limite).toArray(),
        cuentaCollection.countDocuments(filtro)
    ]).then(([cuentas, total]) => {
        res.status(200).json({
            datos: cuentas.map((c) => ({ ...c, _id: c._id?.toString() })),
            pagina,
            limite,
            totalElementos: total,
            totalPaginas: Math.ceil(total / limite)
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al consultar las cuentas" });
    });
};

export const getCuentaById = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    cuentaCollection.findOne({ _id: new ObjectId(id) }).then((cuenta) => {
        if (!cuenta) {
            res.status(404).json({ error: "Cuenta no encontrada" });
            return;
        }

        return clienteCollection.findOne({ _id: new ObjectId(cuenta.clienteId) }).then((cliente) => {
            res.status(200).json({
                _id: cuenta._id?.toString(),
                iban: cuenta.iban,
                clienteId: cuenta.clienteId,
                nombreTitular: cliente ? cliente.nombre : null,
                emailTitular: cliente ? cliente.email : null,
                tipo: cuenta.tipo,
                saldo: cuenta.saldo,
                descubiertoMax: cuenta.descubiertoMax,
                estado: cuenta.estado,
                creadaEn: cuenta.creadaEn
            });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al consultar la cuenta" });
    });
};

export const patchEstadoCuenta = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    const { estado } = req.body || {};
    const estadosValidos: EstadoCuenta[] = ["activa", "bloqueada", "cerrada"];

    if (!estado || !estadosValidos.includes(estado)) {
        res.status(400).json({ error: `Estado inexistente. Permitidos: ${estadosValidos.join(", ")}` });
        return;
    }

    cuentaCollection.findOne({ _id: new ObjectId(id) }).then((cuenta) => {
        if (!cuenta) {
            res.status(404).json({ error: "Cuenta no encontrada" });
            return;
        }

        const actual = cuenta.estado;
        const solicitado = estado as EstadoCuenta;

        if (actual === "cerrada") {
            res.status(409).json({ error: "Transición no permitida: la cuenta está cerrada y su estado es irreversible" });
            return;
        }

        if (actual === solicitado) {
            res.status(200).json({ ...cuenta, _id: cuenta._id?.toString() });
            return;
        }

        if (solicitado === "cerrada" && cuenta.saldo !== 0) {
            res.status(409).json({
                error: `No se puede cerrar una cuenta con saldo distinto de 0 (saldo actual: ${cuenta.saldo})`
            });
            return;
        }

        return cuentaCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { estado: solicitado } },
            { returnDocument: "after" }
        ).then((actualizada) => {
            res.status(200).json({ ...actualizada, _id: actualizada?._id?.toString() });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al actualizar el estado de la cuenta" });
    });
};

export const postIngreso = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    const { importe, concepto, categoria } = req.body || {};

    if (!Number.isInteger(importe) || importe <= 0) {
        res.status(400).json({ error: "El importe debe ser un entero positivo mayor a 0 (en céntimos)" });
        return;
    }

    if (!concepto || typeof concepto !== "string" || !concepto.trim()) {
        res.status(400).json({ error: "El concepto es obligatorio" });
        return;
    }

    cuentaCollection.findOne({ _id: new ObjectId(id) }).then((cuenta) => {
        if (!cuenta) {
            res.status(404).json({ error: "Cuenta no encontrada" });
            return;
        }

        if (cuenta.estado === "cerrada") {
            res.status(409).json({ error: "No se admiten ingresos en una cuenta cerrada" });
            return;
        }

        const nuevoSaldo = cuenta.saldo + importe;

        return cuentaCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { saldo: nuevoSaldo } }
        ).then(() => {
            const movimiento: MovimientoT = {
                cuentaId: id,
                tipo: "ingreso",
                importe,
                saldoResultante: nuevoSaldo,
                concepto: concepto.trim(),
                categoria: categoria ? String(categoria).trim() : "otros",
                fecha: new Date().toISOString()
            };

            return movimientoCollection.insertOne(movimiento).then((movRes) => {
                res.status(201).json({
                    _id: movRes.insertedId.toString(),
                    ...movimiento
                });
            });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al procesar el ingreso" });
    });
};

export const postRetirada = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    const { importe, concepto, categoria } = req.body || {};

    if (!Number.isInteger(importe) || importe <= 0) {
        res.status(400).json({ error: "El importe debe ser un entero positivo mayor a 0 (en céntimos)" });
        return;
    }

    if (!concepto || typeof concepto !== "string" || !concepto.trim()) {
        res.status(400).json({ error: "El concepto es obligatorio" });
        return;
    }

    cuentaCollection.findOne({ _id: new ObjectId(id) }).then((cuenta) => {
        if (!cuenta) {
            res.status(404).json({ error: "Cuenta no encontrada" });
            return;
        }

        if (cuenta.estado !== "activa") {
            res.status(409).json({ error: `No se permiten retiradas en cuentas con estado: ${cuenta.estado}` });
            return;
        }

        const limiteDescubierto = -cuenta.descubiertoMax;
        const disponible = cuenta.saldo - limiteDescubierto;

        if (cuenta.saldo - importe < limiteDescubierto) {
            res.status(409).json({
                error: `Saldo insuficiente: disponible ${disponible} céntimos (incluido descubierto), solicitado ${importe}`
            });
            return;
        }

        const inicioDia = new Date();
        inicioDia.setHours(0, 0, 0, 0);

        return movimientoCollection.aggregate([
            {
                $match: {
                    cuentaId: id,
                    tipo: "retirada",
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
            const retiradoHoy = resultado[0]?.total ? Math.abs(Number(resultado[0].total)) : 0;

            if (retiradoHoy + importe > 100000) {
                res.status(409).json({
                    error: `Límite diario superado: ya ha retirado ${retiradoHoy} céntimos hoy. Límite máximo: 100000`
                });
                return;
            }

            const nuevoSaldo = cuenta.saldo - importe;

            return cuentaCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { saldo: nuevoSaldo } }
            ).then(() => {
                const movimiento: MovimientoT = {
                    cuentaId: id,
                    tipo: "retirada",
                    importe: -importe,
                    saldoResultante: nuevoSaldo,
                    concepto: concepto.trim(),
                    categoria: categoria ? String(categoria).trim() : "otros",
                    fecha: new Date().toISOString()
                };

                return movimientoCollection.insertOne(movimiento).then((movRes) => {
                    res.status(201).json({
                        _id: movRes.insertedId.toString(),
                        ...movimiento
                    });
                });
            });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al procesar la retirada" });
    });
};

export const getMovimientosCuenta = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    cuentaCollection.findOne({ _id: new ObjectId(id) }).then((cuenta) => {
        if (!cuenta) {
            res.status(404).json({ error: "Cuenta no encontrada" });
            return;
        }

        const { tipo, categoria, desde, hasta, orden } = req.query;
        const pagina = Math.max(1, parseInt(req.query.pagina as string) || 1);
        const limite = Math.min(100, Math.max(1, parseInt(req.query.limite as string) || 20));
        const skip = (pagina - 1) * limite;

        const filtro: Record<string, any> = { cuentaId: id };

        if (tipo) {
            const tipos = (tipo as string).split(",").map((t) => t.trim());
            filtro.tipo = { $in: tipos };
        }

        if (categoria) {
            filtro.categoria = categoria;
        }

        if (desde || hasta) {
            filtro.fecha = {};
            if (desde) filtro.fecha.$gte = new Date(desde as string).toISOString();
            if (hasta) {
                const fechaHasta = new Date(hasta as string);
                fechaHasta.setUTCHours(23, 59, 59, 999);
                filtro.fecha.$lte = fechaHasta.toISOString();
            }
        }

        const ordenSort = orden === "fecha" ? 1 : -1;

        return Promise.all([
            movimientoCollection.find(filtro).sort({ fecha: ordenSort }).skip(skip).limit(limite).toArray(),
            movimientoCollection.countDocuments(filtro)
        ]).then(([movimientos, total]) => {
            res.status(200).json({
                datos: movimientos.map((m) => ({ ...m, _id: m._id?.toString() })),
                pagina,
                limite,
                totalElementos: total,
                totalPaginas: Math.ceil(total / limite)
            });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al consultar los movimientos" });
    });
};