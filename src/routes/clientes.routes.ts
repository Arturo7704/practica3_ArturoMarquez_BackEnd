import { Router } from "express";
import {
    postCliente,
    getClientes,
    getClienteById,
    patchCliente
} from "../controllers/clientes.controller.js";

const router = Router();

router.post("/", postCliente);
router.get("/", getClientes);
router.get("/:id", getClienteById);
router.patch("/:id", patchCliente);

export default router;