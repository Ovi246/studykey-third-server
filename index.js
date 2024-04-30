const express = require("express");
const geoip = require("fast-geoip");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const SellingPartnerAPI = require("amazon-sp-api");
const app = express();
app.use(express.json());
require("dotenv").config();
const cors = require("cors");
const allowedOrigins = ["https://studykey-riddles.vercel.app"];
const nodemailer = require("nodemailer");

const createDOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

// Create a transporter object using the default SMTP transport
let transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // Your Gmail address
    pass: process.env.GMAIL_PASS, // Your Gmail password or App Password
  },
});

// Enable various security headers
app.use(helmet());

// Limit requests to 100 per hour per IP
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // limit each IP to 100 requests per windowMs
});

// Apply rate limiter to all requests
app.use(limiter);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        var msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
  })
);

let sellingPartner = new SellingPartnerAPI({
  region: "na", // The region of the selling partner API endpoint (“eu”, “na” or “fe”)
  refresh_token: process.env.REFRESH_TOKEN, // The refresh token of your app user
  options: {
    credentials: {
      SELLING_PARTNER_APP_CLIENT_ID: process.env.SELLING_PARTNER_APP_CLIENT_ID,
      SELLING_PARTNER_APP_CLIENT_SECRET:
        process.env.SELLING_PARTNER_APP_CLIENT_SECRET,
    },
  },
});

app.post("/validate-order-id", async (req, res) => {
  const { orderId } = req.body;
  try {
    const order = await sellingPartner.callAPI({
      operation: "getOrder",
      endpoint: "orders",
      path: {
        orderId: orderId,
      },
    });

    if (Object.keys(order).length > 0) {
      // // Get the order items
      // const orderItems = await sellingPartner.callAPI({
      //   operation: "getOrderItems",
      //   endpoint: "orders",
      //   path: {
      //     orderId: orderId,
      //   },
      // });

      // // Extract the ASINs from the order items
      // const asins = orderItems.OrderItems.map((item) => item.ASIN);

      res.status(200).send({ valid: true });
    } else {
      res.status(400).send({ valid: false });
    }
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .send({ error: "An error occurred while validating the order ID" });
  }
});

app.post("/submit-review", async (req, res) => {
  const formData = req.body;

  if (formData) {
    let mailOptions = {
      from: process.env.GMAIL_USER, // Sender address
      to: process.env.GMAIL_USER, // Admin's email
      subject: "New PDF Claimed", // Subject line
      html: DOMPurify.sanitize(`
        <h1>New Order Submission</h1>
        <p><strong>User Name:</strong> ${formData.name}</p>
        <p><strong>Language:</strong> ${formData.language}</p>
        <p><strong>Level:</strong> ${formData.level}</p>
        <p><strong>Email:</strong> ${formData.email}</p>
        <p><strong>Set:</strong> ${formData.set}</p>
        <p><strong>OrderID:</strong> ${formData.orderId}</p>
      `), // Sanitized HTML body
    };

    // Send email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log(error);
      } else {
        res.status(200).send({ success: true });
      }
    });
  }
});

app.get("/", async (req, res) => {
  res.status(200).send("api running");
});

app.get("/api/location", async (req, res) => {
  const ip = req.ip || "127.0.0.1";
  const geo = await geoip.lookup(ip);
  res.send(geo);
});

// app.listen(5000, function (err) {
//   if (err) console.log("Error in server setup");
//   console.log("Server listening on Port", 5000);
// });

module.exports = app;
