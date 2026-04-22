require("dotenv").config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/payments",
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  jwt: {
    secret: process.env.JWT_SECRET || "changeme-use-a-strong-secret-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  bcrypt: {
    saltRounds: 12,
  },

  account: {
    initialBalanceMin: 1000,
    initialBalanceMax: 10000,
    maxTransferAmount: 1_000_000,
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    authMax: 10, // stricter for auth routes
  },
};

// Validate critical config at startup
if (config.nodeEnv === "production" && config.jwt.secret === "changeme-use-a-strong-secret-in-production") {
  throw new Error("JWT_SECRET must be set in production environment");
}

module.exports = config;