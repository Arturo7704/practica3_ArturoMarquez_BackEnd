import { Router } from "express";
import { postTransferencia } from "../controllers/transferencias.controller.js";

const router = Router();

router.post("/transferencias", postTransferencia);

export default router;