const express = require("express");
const SellingPartnerAPI = require("amazon-sp-api");
const AWS = require("aws-sdk");
const fs = require("fs");
const app = express();
app.use(express.json());
require("dotenv").config();
const cors = require("cors");
const allowedOrigins = ["https://feedback-page-pi.vercel.app/"];
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
      //   AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      //   AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      //   AWS_SELLING_PARTNER_ROLE: process.env.AWS_SELLING_PARTNER_ROLE,
    },
  },
});

// AWS.config.update({ region: process.env.AWS_REGION }); // replace with your region
// const ses = new AWS.SES({ apiVersion: "2010-12-01" });

app.post("/validate-order-id", async (req, res) => {
  const formData = req.body;

  // Extract the order ID from the form data
  const orderId = formData.orderId;

  try {
    const order = await sellingPartner.callAPI({
      operation: "getOrder",
      endpoint: "orders",
      path: {
        orderId: orderId,
      },
    });

    if (order) {
      //   const params = {
      //     Destination: {
      //       ToAddresses: [formData.customerEmail], // customer's email
      //     },
      //     Message: {
      //       Body: {
      //         Text: {
      //           Data: "Here is your Amazon gift card code: ABCD-EFGH-IJKL",
      //         }, // replace with the actual gift card code
      //       },
      //       Subject: { Data: "Your Amazon Gift Card" },
      //     },
      //     Source: process.env.EMAIL, // replace with your email
      //   };

      //   ses.sendEmail(params, function (err, data) {
      //     if (err) {
      //       console.error(err, err.stack);
      //       res
      //         .status(500)
      //         .send({ error: "An error occurred while sending the email" });
      //     } else {
      //       console.log("Message sent: %s", data.MessageId);
      //       res.status(200).send({ valid: true });
      //     }
      //   });

      // Get the order items
      const orderItems = await sellingPartner.callAPI({
        operation: "getOrderItems",
        endpoint: "orders",
        path: {
          orderId: orderId,
        },
      });

      // Extract the ASINs from the order items
      const asins = orderItems.OrderItems.map((item) => item.ASIN);
      console.log(asins);
      // Save the form data and ASINs to a JSON file
      fs.writeFileSync("formData.json", JSON.stringify({ ...formData, asins }));

      res.status(200).send({ valid: true, asins });
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

app.get("/", async (req, res) => {
  res.status(200).send("api running");
});

module.exports = app;
