import express from "express";
import { connectAlMonguito } from "./database.js";
import clientesRoutes from "./routes/clientes.routes.js";
import cuentasRoutes from "./routes/cuentas.routes.js";
import transferenciasRoutes from "./routes/transferencias.routes.js";

import { configClienteCollection } from "./controllers/clientes.controller.js";
import { configCuentaCollections } from "./controllers/cuentas.controller.js";
import { configTransferenciaCollections } from "./controllers/transferencias.controller.js";

import type { Collection } from "mongodb";
import type { ClienteT } from "./models/clientes.model.js";
import type { CuentaT } from "./models/cuentas.model.js";
import type { MovimientoT } from "./models/movimientos.model.js";

const app = express();
app.use(express.json());

const PORT = 3000;

const startServer = () => {
    connectAlMonguito().then((basededatos) => {
        const clienteCollection: Collection<ClienteT> = basededatos.collection("clientes");
        const cuentaCollection: Collection<CuentaT> = basededatos.collection("cuentas");
        const movimientoCollection: Collection<MovimientoT> = basededatos.collection("movimientos");

        configClienteCollection(clienteCollection);
        configCuentaCollections(cuentaCollection, clienteCollection, movimientoCollection);
        configTransferenciaCollections(cuentaCollection, movimientoCollection);

        app.use("/clientes", clientesRoutes);
        app.use("/cuentas", cuentasRoutes);
        app.use("/transferencias", transferenciasRoutes);

        app.listen(PORT, () => {
            console.log(`Servidor bancario escuchando en el puerto ${PORT}`);
        });
    }).catch(() => {
        console.log("Error no se ha iniciado el servidor");
    });
};

startServer();