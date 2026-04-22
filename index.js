const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const logger = require("./logger");
const { connect } = require("./db");
const router = require("./routes");
const { notFoundHandler, errorHandler } = require("./middleware");

const app = express();

// ─── Security Middleware ─────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  message: { success: false, message: "Too many authentication attempts, please try again later" },
});

app.use(globalLimiter);
app.use("/api/v1/user/signin", authLimiter);
app.use("/api/v1/user/signup", authLimiter);

// ─── Request Parsing ─────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" })); // Limit body size
app.use(express.urlencoded({ extended: true }));

// ─── Logging ─────────────────────────────────────────────────────────────────
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === "/health",
  })
);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use("/api/v1", router);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await connect();

    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`, { env: config.nodeEnv });
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        const mongoose = require("mongoose");
        await mongoose.connection.close();
        logger.info("Server closed. MongoDB disconnected.");
        process.exit(0);
      });

      // Force shutdown after 10s
      setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10_000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Promise Rejection", { reason });
    });

    process.on("uncaughtException", (err) => {
      logger.error("Uncaught Exception", { error: err.message, stack: err.stack });
      process.exit(1);
    });

    return server;
  } catch (err) {
    logger.error("Failed to start server", { error: err.message });
    process.exit(1);
  }
};

start();

module.exports = app; // For testing