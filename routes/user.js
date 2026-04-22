const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const User = require("../models/User");
const Account = require("../models/Account");
const config = require("../config");
const logger = require("../logger");
const { authMiddleware, validate } = require("../middleware");

const router = express.Router();

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const signupSchema = z.object({
  username: z.string().email("Invalid email address").toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1).max(50).trim(),
  lastName: z.string().min(1).max(50).trim(),
});

const signinSchema = z.object({
  username: z.string().email("Invalid email address").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

const updateUserSchema = z
  .object({
    password: z.string().min(6).optional(),
    firstName: z.string().min(1).max(50).trim().optional(),
    lastName: z.string().min(1).max(50).trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

const bulkQuerySchema = z.object({
  filter: z.string().optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

const generateToken = (userId) => {
  return jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
};

const getRandomBalance = () => {
  const { initialBalanceMin, initialBalanceMax } = config.account;
  return parseFloat(
    (Math.random() * (initialBalanceMax - initialBalanceMin) + initialBalanceMin).toFixed(2)
  );
};

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/user/signup
 * Register a new user and create their account with a random balance
 */
router.post("/signup", validate(signupSchema), async (req, res, next) => {
  try {
    const { username, password, firstName, lastName } = req.body;

    // Check duplicate before creating (better error message)
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }

    const user = await User.create({ username, password, firstName, lastName });

    // Create account with random balance atomically
    await Account.create({
      userId: user._id,
      balance: getRandomBalance(),
    });

    const token = generateToken(user._id);

    logger.info("User registered", { userId: user._id, username });

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/user/signin
 * Authenticate user and return JWT
 */
router.post("/signin", validate(signinSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Explicitly select password (it's excluded by default)
    const user = await User.findOne({ username }).select("+password");
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(user._id);

    logger.info("User signed in", { userId: user._id });

    res.json({
      success: true,
      message: "Signed in successfully",
      token,
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/user/
 * Update authenticated user's profile
 */
router.put("/", authMiddleware, validate(updateUserSchema), async (req, res, next) => {
  try {
    const updates = req.body;

    const user = await User.findById(req.userId).select("+password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Apply updates manually so pre-save hook (bcrypt) fires on password
    if (updates.firstName) user.firstName = updates.firstName;
    if (updates.lastName) user.lastName = updates.lastName;
    if (updates.password) user.password = updates.password;

    await user.save();

    logger.info("User updated", { userId: req.userId });

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/user/bulk?filter=&page=&limit=
 * Search users by name or email (excludes current user)
 */
router.get("/bulk", authMiddleware, validate(bulkQuerySchema, "query"), async (req, res, next) => {
  try {
    const { filter, page, limit } = req.query;
    const skip = (page - 1) * limit;

    const searchRegex = new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const query = {
      _id: { $ne: req.userId }, // Exclude self
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { username: searchRegex },
      ],
    };

    const [users, total] = await Promise.all([
      User.find(query).select("firstName lastName username").skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;