import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import classesRoutes from "./routes/classesRoutes";
import contentRoutes from "./routes/contentRoutes";
import quizRoutes from "./routes/quizRoutes";
import userRoutes from "./routes/userRoutes";
import stripeRoutes from "./routes/stripeRoutes";

dotenv.config();
const app = express();

if (process.env.NODE_ENV !== "production") {
  app.use(
    cors({
      origin: [
        "http://localhost:3000",
        "http://10.20.8.48:3000",
        "http://10.0.0.230:3000",
        "https://passthatclass.com",
        "https://www.passthatclass.com",
      ],
      credentials: true,
    })
  );
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});
app.set("trust proxy", 1);

app.use("/stripe", stripeRoutes);

app.use(express.json());

app.use("/classes", classesRoutes);
app.use("/content", contentRoutes);
app.use("/quiz", quizRoutes);
app.use("/user", userRoutes);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
