import mongoose from "mongoose";

const connectDB = async () => {
  const uriRaw = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
  if (!uriRaw) {
    throw new Error("Missing MONGODB_URI in environment (.env).");
  }

  // Log a redacted version for debugging
  const redacted = uriRaw.replace(/\/\/([^:]+):([^@]+)@/, (_m, u) => `//${u}:****@`);
  console.log("Connecting to MongoDB:", redacted);

  try {
    // Do NOT append a database here — keep the full URI in MONGODB_URI (with db name & params)
    await mongoose.connect(uriRaw, {
      // modern mongoose uses sensible defaults; options kept minimal
      // serverSelectionTimeoutMS: 10000,
    });
    mongoose.connection.on("connected", () => {
      console.log("✅ Database Connected");
    });
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB error:", err?.message || err);
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err?.message || err);
    throw err;
  }
};

export default connectDB;
