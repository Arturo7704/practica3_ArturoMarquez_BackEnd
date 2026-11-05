import { Db, MongoClient } from 'mongodb';

const client = new MongoClient("mongodb+srv://arturoma7704_db_user:**********@cluster0.sycklsy.mongodb.net/");

export const connectAlMonguito = (): Promise<Db> => {
    return client.connect().then(() => {
        console.log("Te has conectado al Monguito");
        return client.db("banco"); // <-- Cambiado de "proyectos" a "banco"
    }).catch((error) => {
        console.log("Error al conectarse");
        throw error;
    });
};