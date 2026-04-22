const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 3000;

let retryCount = 0;

const connect = async () => {
  try {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    retryCount = 0;
    logger.info("MongoDB connected", { uri: config.mongodb.uri.replace(/\/\/.*@/, "//***@") });
  } catch (err) {
    retryCount++;
    logger.error("MongoDB connection error", { error: err.message, attempt: retryCount });

    if (retryCount < MAX_RETRIES) {
      logger.info(`Retrying MongoDB connection in ${RETRY_INTERVAL_MS / 1000}s...`);
      setTimeout(connect, RETRY_INTERVAL_MS);
    } else {
      logger.error("Max MongoDB connection retries reached. Exiting.");
      process.exit(1);
    }
  }
};

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected. Attempting reconnect...");
  connect();
});

mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected");
});

module.exports = { connect };