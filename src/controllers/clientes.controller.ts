import { type Request, type Response } from "express";
import { ObjectId, type Collection } from "mongodb";
import type { ClienteT } from "../models/clientes.model.js";

let clienteCollection: Collection<ClienteT>;

export const configClienteCollection = (coleccion: Collection<ClienteT>) => {
    clienteCollection = coleccion;
};

const mapCliente = (doc: any) => ({
    _id: doc._id.toString(),
    nombre: doc.nombre,
    email: doc.email,
    dni: doc.dni,
    creadoEn: doc.creadoEn
});

export const postCliente = (req: Request, res: Response) => {
    const { nombre, email, dni } = req.body || {};

    if (!nombre || !email || !dni) {
        res.status(400).json({ error: "Los campos nombre, email y dni son obligatorios" });
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        res.status(400).json({ error: "El email no tiene un formato válido" });
        return;
    }

    const dniRegex = /^\d{8}[A-Za-z]$/;
    if (!dniRegex.test(dni)) {
        res.status(400).json({ error: "El DNI debe contener 8 dígitos y una letra" });
        return;
    }

    const emailLimpio = String(email).trim().toLowerCase();
    const dniLimpio = String(dni).trim().toUpperCase();

    // Comprobación previa manual de duplicados
    clienteCollection.findOne({
        $or: [{ email: emailLimpio }, { dni: dniLimpio }]
    }).then((clienteExistente) => {
        if (clienteExistente) {
            res.status(409).json({ error: "El email o el DNI ya están registrados" });
            return;
        }

        const nuevoCliente: ClienteT = {
            nombre: String(nombre).trim(),
            email: emailLimpio,
            dni: dniLimpio,
            creadoEn: new Date().toISOString()
        };

        return clienteCollection.insertOne(nuevoCliente).then((result) => {
            res.status(201).json({
                _id: result.insertedId.toString(),
                ...nuevoCliente
            });
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al crear el cliente" });
    });
};

export const getClientes = (req: Request, res: Response) => {
    const pagina = Math.max(1, parseInt(req.query.pagina as string) || 1);
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite as string) || 20));
    const skip = (pagina - 1) * limite;

    Promise.all([
        clienteCollection.find().skip(skip).limit(limite).toArray(),
        clienteCollection.countDocuments()
    ]).then(([clientes, total]) => {
        res.status(200).json({
            datos: clientes.map(mapCliente),
            pagina,
            limite,
            totalElementos: total,
            totalPaginas: Math.ceil(total / limite)
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al listar los clientes" });
    });
};

export const getClienteById = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    clienteCollection.findOne({ _id: new ObjectId(id) }).then((cliente) => {
        if (!cliente) {
            res.status(404).json({ error: "Cliente no encontrado" });
            return;
        }
        res.status(200).json(mapCliente(cliente));
    }).catch(() => {
        res.status(500).json({ error: "Error al consultar el cliente" });
    });
};

export const patchCliente = (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
        res.status(400).json({ error: "El id proporcionado no es un ObjectId válido" });
        return;
    }

    const { nombre, email, dni } = req.body || {};

    if (dni !== undefined) {
        res.status(409).json({ error: "El DNI no se puede modificar" });
        return;
    }

    const updates: Record<string, any> = {};

    if (nombre !== undefined) {
        if (!String(nombre).trim()) {
            res.status(400).json({ error: "El nombre no puede estar vacío" });
            return;
        }
        updates.nombre = String(nombre).trim();
    }

    if (email !== undefined) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            res.status(400).json({ error: "El email no tiene un formato válido" });
            return;
        }
        updates.email = String(email).trim().toLowerCase();
    }

    if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "No se enviaron datos para actualizar" });
        return;
    }

    // Comprobar si el nuevo email ya le pertenece a otro cliente
    const verificarEmail = updates.email
        ? clienteCollection.findOne({ email: updates.email, _id: { $ne: new ObjectId(id) } })
        : Promise.resolve(null);

    verificarEmail.then((emailRepetido) => {
        if (emailRepetido) {
            res.status(409).json({ error: "El email indicado ya está en uso" });
            return;
        }

        return clienteCollection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updates },
            { returnDocument: "after" }
        ).then((clienteActualizado) => {
            if (!clienteActualizado) {
                res.status(404).json({ error: "Cliente no encontrado" });
                return;
            }
            res.status(200).json(mapCliente(clienteActualizado));
        });
    }).catch(() => {
        res.status(500).json({ error: "Error al actualizar el cliente" });
    });
};