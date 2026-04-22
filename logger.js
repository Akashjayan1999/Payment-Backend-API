const { createLogger, format, transports } = require("winston");
const config = require("./config");

const { combine, timestamp, errors, json, colorize, simple } = format;

const logger = createLogger({
  level: config.nodeEnv === "production" ? "info" : "debug",
  format: combine(timestamp(), errors({ stack: true }), json()),
  defaultMeta: { service: "payments-api" },
  transports: [
    new transports.Console({
      format:
        config.nodeEnv === "production"
          ? combine(timestamp(), json())
          : combine(colorize(), simple()),
    }),
  ],
});

module.exports = logger;