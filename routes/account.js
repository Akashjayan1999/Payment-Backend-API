const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const Account = require("../models/Account");
const User = require("../models/User");
const config = require("../config");
const logger = require("../logger");
const { authMiddleware, validate } = require("../middleware");

const router = express.Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const transferSchema = z.object({
  to: z.string().min(1, "Recipient user ID is required"),
  amount: z
    .number()
    .positive("Amount must be positive")
    .max(config.account.maxTransferAmount, `Maximum transfer is ${config.account.maxTransferAmount}`)
    .multipleOf(0.01, "Amount can have at most 2 decimal places"),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/account/balance
 * Get authenticated user's current balance
 */
router.get("/balance", authMiddleware, async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.userId }).lean();

    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    res.json({
      success: true,
      balance: account.balance,
      currency: "USD",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/account/transfer
 * Transfer funds from authenticated user to another user
 * Uses MongoDB transactions to ensure atomicity
 */
router.post("/transfer", authMiddleware, validate(transferSchema), async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { to, amount } = req.body;
    const fromUserId = req.userId;

    // Validate recipient exists and is not self
    if (to === fromUserId.toString()) {
      return res.status(400).json({ success: false, message: "Cannot transfer to yourself" });
    }

    const recipientExists = await User.exists({ _id: to });
    if (!recipientExists) {
      return res.status(404).json({ success: false, message: "Recipient not found" });
    }

    let transferResult;

    await session.withTransaction(async () => {
      // Lock both accounts within transaction using findOneAndUpdate
      const senderAccount = await Account.findOneAndUpdate(
        { userId: fromUserId, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { new: true, session }
      );

      if (!senderAccount) {
        // Check if account exists at all, or just insufficient balance
        const accountExists = await Account.exists({ userId: fromUserId }).session(session);
        const error = new Error(
          accountExists ? "Insufficient balance" : "Sender account not found"
        );
        error.statusCode = accountExists ? 422 : 404;
        throw error;
      }

      const recipientAccount = await Account.findOneAndUpdate(
        { userId: to },
        { $inc: { balance: amount } },
        { new: true, session }
      );

      if (!recipientAccount) {
        const error = new Error("Recipient account not found");
        error.statusCode = 404;
        throw error;
      }

      transferResult = {
        newBalance: senderAccount.balance,
        transferredAmount: amount,
        recipientId: to,
      };

      logger.info("Transfer completed", {
        from: fromUserId,
        to,
        amount,
        senderNewBalance: senderAccount.balance,
      });
    });

    res.json({
      success: true,
      message: "Transfer successful",
      ...transferResult,
    });
  } catch (err) {
    // Pass to error handler; session is automatically aborted by withTransaction
    next(err);
  } finally {
    session.endSession();
  }
});

module.exports = router;