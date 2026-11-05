import { Router } from "express";
import {
    postCuenta,
    getCuentas,
    getCuentaById,
    patchEstadoCuenta,
    postIngreso,
    postRetirada,
    getMovimientosCuenta
} from "../controllers/cuentas.controller.js";

const router = Router();

router.post("/", postCuenta);
router.get("/", getCuentas);
router.get("/:id", getCuentaById);
router.patch("/:id/estado", patchEstadoCuenta);
router.get("/:id/movimientos", getMovimientosCuenta);
router.post("/:id/ingresos", postIngreso);
router.post("/:id/retiradas", postRetirada);

export default router;