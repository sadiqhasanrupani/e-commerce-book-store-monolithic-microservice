import Razorpay from "razorpay";

const key = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

export const RazorPayInstance = new Razorpay({
  key_id: key,
  key_secret,
})
