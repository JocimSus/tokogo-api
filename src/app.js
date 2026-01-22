import express from "express";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import detectionRoutes from "./routes/detections.js";
import cartRoutes from "./routes/cart.js";
// import staffRoutes from "./routes/staff.js";
import { corsConfig } from "./middleware/cors.js";
import cookieParser from "cookie-parser";
import swaggerUi from 'swagger-ui-express';
import YAML from "yaml";
import fs from "fs";
import { restrictInProd } from "./middleware/restrict.js";

const app = express();
const file = fs.readFileSync("swagger.yaml", "utf8");
const swaggerDocument = YAML.parse(file);
dotenv.config();

app.use(corsConfig);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser())

app.use("/v1/auth", authRoutes);
// app.use('/v1/staff', staffRoutes); // Currently not used because, there is no need to track staff
app.use('/v1/products', productRoutes);
app.use('/v1/cart', cartRoutes);
app.use('/v1/detections', detectionRoutes);
app.use('/v1/docs', restrictInProd, swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" })
})

export default app;
