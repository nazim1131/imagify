import userModel from "../models/userModel.js"
import transactionModel from "../models/transactionModel.js"
import razorpay from 'razorpay';
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import stripe from "stripe";

// API to register user
const registerUser = async (req, res) => {

    try {
        const { name, email, password } = req.body;

        // checking for all data to register user
        if (!name || !email || !password) {
            return res.json({ success: false, message: 'Missing Details' })
        }

        // hashing user password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt)

        const userData = {
            name,
            email,
            password: hashedPassword,
        }

        const newUser = new userModel(userData)
        const user = await newUser.save()

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)

        res.json({ success: true, token, user: { name: user.name } })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to login user
const loginUser = async (req, res) => {

    try {
        const { email, password } = req.body;
        const user = await userModel.findOne({ email })

        if (!user) {
            return res.json({ success: false, message: "User does not exist" })
        }

        const isMatch = await bcrypt.compare(password, user.password)

        if (isMatch) {
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)
            res.json({ success: true, token, user: { name: user.name } })
        }
        else {
            res.json({ success: false, message: "Invalid credentials" })
        }
    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API Controller function to get user available credits data
const userCredits = async (req, res) => {
    try {

        const { userId } = req.body

        // Fetching userdata using userId
        const user = await userModel.findById(userId)
        res.json({ success: true, credits: user.creditBalance, user: { name: user.name } })

    } catch (error) {
        console.log(error.message)
        res.json({ success: false, message: error.message })
    }
}

// razorpay gateway initialize
const razorpayInstance = new razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});


// Payment API to add credits
const paymentRazorpay = async (req, res) => {
    try {

        const { userId, planId } = req.body

        const userData = await userModel.findById(userId)

        // checking for planId and userdata
        if (!userData || !planId) {
            return res.json({ success: false, message: 'Missing Details' })
        }

        let credits, plan, amount, date

        // Switch Cases for different plans
        switch (planId) {
            case 'Basic':
                plan = 'Basic'
                credits = 100
                amount = 10
                break;

            case 'Advanced':
                plan = 'Advanced'
                credits = 500
                amount = 50
                break;

            case 'Business':
                plan = 'Business'
                credits = 5000
                amount = 250
                break;

            default:
                return res.json({ success: false, message: 'plan not found' })
        }

        date = Date.now()

        // Creating Transaction Data
        const transactionData = {
            userId,
            plan,
            amount,
            credits,
            date
        }

        // Saving Transaction Data to Database
        const newTransaction = await transactionModel.create(transactionData)

        // Creating options to create razorpay Order
        const options = {
            amount: amount * 100,
            currency: process.env.CURRENCY,
            receipt: newTransaction._id,
        }

        // Creating razorpay Order
        await razorpayInstance.orders.create(options, (error, order) => {
            if (error) {
                console.log(error);
                return res.json({ success: false, message: error });
            }
            res.json({ success: true, order });
        })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API Controller function to verify razorpay payment
const verifyRazorpay = async (req, res) => {
    try {

        const { razorpay_order_id } = req.body;

        // Fetching order data from razorpay
        const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id);

        // Checking for payment status
        if (orderInfo.status === 'paid') {
            const transactionData = await transactionModel.findById(orderInfo.receipt)
            if (transactionData.payment) {
                return res.json({ success: false, message: 'Payment Failed' })
            }

            // Adding Credits in user data
            const userData = await userModel.findById(transactionData.userId)
            const creditBalance = userData.creditBalance + transactionData.credits
            await userModel.findByIdAndUpdate(userData._id, { creditBalance })

            // Marking the payment true 
            await transactionModel.findByIdAndUpdate(transactionData._id, { payment: true })

            res.json({ success: true, message: "Credits Added" });
        }
        else {
            res.json({ success: false, message: 'Payment Failed' });
        }

    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
}

// Stripe Gateway Initialize
const stripeInstance = new stripe(process.env.STRIPE_SECRET_KEY)

// Payment API to add credits ( Stripe )
const paymentStripe = async (req, res) => {
  try {
    const { userId, planId } = req.body;
    const originHeader = req.headers.origin;
    const origin =
      originHeader ||
      process.env.FRONTEND_URL || // set this in Render, e.g. https://imagify-frontend.onrender.com
      "";

    if (!userId || !planId) {
      return res.json({ success: false, message: "Invalid Credentials" });
    }

    const userData = await userModel.findById(userId);
    if (!userData) {
      return res.json({ success: false, message: "User not found" });
    }

    // planId case-insensitive
    const planKey = String(planId).toLowerCase();
    let credits, plan, amountUsd;
    switch (planKey) {
      case "basic":
        plan = "Basic";
        credits = 100;
        amountUsd = 10;
        break;
      case "advanced":
        plan = "Advanced";
        credits = 500;
        amountUsd = 50;
        break;
      case "business":
        plan = "Business";
        credits = 5000;
        amountUsd = 250;
        break;
      default:
        return res.json({ success: false, message: "plan not found" });
    }

    const currency =
      (process.env.CURRENCY && process.env.CURRENCY.toLowerCase()) || "inr";

    // stripe price is in smallest unit
    // If currency is INR → paise; USD → cents. Your amounts look like USD dollars.
    // Adjust this to your business logic. If you're charging in INR, convert appropriately.
    const unitAmount =
      currency === "inr" ? Math.round(amountUsd * 100 * 83) : amountUsd * 100;
    // ↑ Example: rough USD→INR conversion; ideally compute real INR prices upfront,
    // or keep INR amounts in your switch above.

    const date = Date.now();
    const transactionData = {
      userId,
      plan,
      amount: amountUsd, // store display currency amount; or store smallest unit separately
      credits,
      date
    };

    const newTransaction = await transactionModel.create(transactionData);

    const line_items = [
      {
        price_data: {
          currency,
          product_data: { name: `Credit Purchase (${plan})` },
          unit_amount: unitAmount
        },
        quantity: 1
      }
    ];

    if (!origin) {
      // Without a success/cancel URL, Stripe won't redirect. Fail early with a good error.
      return res.status(400).json({
        success: false,
        message:
          "Missing origin/FRONTEND_URL. Set FRONTEND_URL in env or send Origin header."
      });
    }

    const session = await stripeInstance.checkout.sessions.create({
      success_url: `${origin}/verify?success=true&transactionId=${newTransaction._id}`,
      cancel_url: `${origin}/verify?success=false&transactionId=${newTransaction._id}`,
      line_items,
      mode: "payment"
    });

    return res.json({ success: true, session_url: session.url });
  } catch (error) {
    console.error("Stripe error:", error);
    return res.json({ success: false, message: error.message });
  }
};
// API Controller function to verify stripe payment
const verifyStripe = async (req, res) => {
    try {

        const { transactionId, success } = req.body

        // Checking for payment status
        if (success === 'true') {
            const transactionData = await transactionModel.findById(transactionId)
            if (transactionData.payment) {
                return res.json({ success: false, message: 'Payment Already Verified' })
            }

            // Adding Credits in user data
            const userData = await userModel.findById(transactionData.userId)
            const creditBalance = userData.creditBalance + transactionData.credits
            await userModel.findByIdAndUpdate(userData._id, { creditBalance })

            // Marking the payment true 
            await transactionModel.findByIdAndUpdate(transactionData._id, { payment: true })

            res.json({ success: true, message: "Credits Added" });
        }
        else {
            res.json({ success: false, message: 'Payment Failed' });
        }

    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
}


export { registerUser, loginUser, userCredits, paymentRazorpay, verifyRazorpay, paymentStripe, verifyStripe }
