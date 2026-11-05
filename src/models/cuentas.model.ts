import type { ObjectId } from "mongodb";

export type TipoCuenta = "corriente" | "ahorro";
export type EstadoCuenta = "activa" | "bloqueada" | "cerrada";

export type CuentaT = {
    _id?: ObjectId;
    iban: string;
    clienteId: string;
    tipo: TipoCuenta;
    saldo: number;
    descubiertoMax: number;
    estado: EstadoCuenta;
    creadaEn: string;
};