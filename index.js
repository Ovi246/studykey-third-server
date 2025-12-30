const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cloudinary = require("cloudinary");
const SellingPartnerAPI = require("amazon-sp-api");
const path = require("path");
const { Parser } = require("json2csv");
const ejs = require("ejs");
const PDFDocument = require('pdfkit');


const app = express();

// Set up EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
require("dotenv").config();

const cors = require("cors");
const allowedOrigins = [
  "https://study-key-reward.vercel.app",
  "https://studykey-disneyworld-giveaway.vercel.app",
  // "http://localhost:5000",
  // "http://localhost:5173",
];

const nodemailer = require("nodemailer");
const createDOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const mongoose = require("mongoose");

// MongoDB connection optimization
let cachedConnection = null;

async function connectToDatabase() {
  if (cachedConnection) {
    return cachedConnection;
  }

  mongoose.connection.on("connected", () => console.log("MongoDB connected"));
  mongoose.connection.on("error", (err) =>
    console.error("MongoDB connection error:", err)
  );

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
    });

    cachedConnection = conn;
    return conn;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

const Schema = mongoose.Schema;

const OrderSchema = new Schema({
  name: String,
  language: String,
  email: { type: String, required: true },
  orderId: { type: String, unique: true },
  fullName: String,
  country: String,
  streetAddress: String,
  city: String,
  state: String,
  zipCode: String,
  phoneNumber: String,
  createdAt: { type: Date, default: Date.now },
});

const TicketClaimSchema = new Schema({
  orderId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  asin: { type: String }, // Product ASIN
  productName: { type: String }, // Product name from Amazon
  productUrl: { type: String }, // Amazon product URL
  createdAt: { type: Date, default: Date.now },
});

let Order;
let TicketClaim;
let FeedbackTracker;

if (mongoose.models.Order) {
  Order = mongoose.model("Order");
} else {
  Order = mongoose.model("Order", OrderSchema);
}

if (mongoose.models.TicketClaim) {
  TicketClaim = mongoose.model("TicketClaim");
} else {
  TicketClaim = mongoose.model("TicketClaim", TicketClaimSchema);
}

// Import FeedbackTracker model
FeedbackTracker = require('./models/FeedbackTracker');

const handlebars = require("nodemailer-express-handlebars");

// Create a transporter object using the default SMTP transport
let transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // Your Gmail address
    pass: process.env.GMAIL_PASS, // Your Gmail password or App Password
  },
});

transporter.use(
  "compile",
  handlebars({
    viewEngine: {
      extName: ".html", // handlebars extension
      partialsDir: path.join(__dirname, "views/email"),
      layoutsDir: path.join(__dirname, "views/email"),
      defaultLayout: "reward.html", // email template file
    },
    viewPath: path.join(__dirname, "views/email"),
    extName: ".html",
  })
);

// Enable various security headers with relaxed CSP for admin dashboard
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
        ],
        scriptSrcAttr: ["'none'"], // Block inline event handlers
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
        ],
        fontSrc: [
          "'self'",
          "https://cdn.jsdelivr.net",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  })
);

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

// Import admin routes
const feedbackAdminRoutes = require('./routes/admin/feedback');
app.use('/api/admin', feedbackAdminRoutes);

// Import email scheduler
const { processPendingEmails, sendFeedbackEmail } = require('./services/emailScheduler');

let sellingPartner = new SellingPartnerAPI({
  region: "na", // The region of the selling partner API endpoint ("eu", "na" or "fe")
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
  console.log(req.body);
  try {
    const order = await sellingPartner.callAPI({
      operation: "getOrder",
      endpoint: "orders",
      path: {
        orderId: orderId,
      },
    });

    if (Object.keys(order).length > 0) {
      // Get the order items
      const orderItems = await sellingPartner.callAPI({
        operation: "getOrderItems",
        endpoint: "orders",
        path: {
          orderId: orderId,
        },
      });

      // Extract the ASINs and product info from the order items
      const asins = orderItems.OrderItems.map((item) => item.ASIN);
      const products = orderItems.OrderItems.map((item) => ({
        asin: item.ASIN,
        title: item.Title,
        quantity: item.QuantityOrdered
      }));

      res.status(200).send({ 
        valid: true, 
        asins: asins,
        products: products
      });
    } else {
      res.status(404).send({ valid: false });
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
    try {
      await connectToDatabase();

      // Process form data to extract country and state names
      const processedData = {
        ...formData,
        country: formData.country?.name || formData.country,
        state: formData.state?.name || formData.state,
        reviewStatus: "pending",
        reviewSubmittedAt: new Date(),
      };

      const order = new Order(processedData);

      await order.save();

      // Email to the user
      let userMailOptions = {
        from: process.env.GMAIL_USER,
        to: formData.email,
        subject: "Study Key FREE gift",
        template: "reward",
        context: {
          name: formData.name,
        },
      };

      // Admin notification email
      let adminMailOptions = {
        from: process.env.GMAIL_USER,
        to: process.env.GMAIL_USER,
        subject: "New Testimonial Claimed",
        html: DOMPurify.sanitize(`
          <h1>New Order Submission</h1>
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h3>Order Information</h3>
            <p><strong>Order ID:</strong> ${processedData.orderId || 'N/A'}</p>
            <p><strong>Full Name:</strong> ${processedData.fullName || 'N/A'}</p>
            <p><strong>Email:</strong> ${processedData.email || 'N/A'}</p>
            <p><strong>Phone Number:</strong> ${processedData.phoneNumber || 'N/A'}</p>
            
            <h3>Shipping Address</h3>
            <p><strong>Street Address:</strong> ${processedData.streetAddress || 'N/A'}</p>
            <p><strong>City:</strong> ${processedData.city || 'N/A'}</p>
            <p><strong>State:</strong> ${processedData.state || 'N/A'}</p>
            <p><strong>ZIP Code:</strong> ${processedData.zipCode || 'N/A'}</p>
            <p><strong>Country:</strong> ${processedData.country || 'N/A'}</p>
            
            <h3>Additional Information</h3>
            <p><strong>Name (Original):</strong> ${processedData.name || 'N/A'}</p>
            <p><strong>Language:</strong> ${processedData.language || 'N/A'}</p>
            <p><strong>Submitted At:</strong> ${new Date(processedData.reviewSubmittedAt).toLocaleString()}</p>
          </div>
        `),
      };

      await Promise.all([
        new Promise((resolve, reject) => {
          transporter.sendMail(userMailOptions, (error, info) => {
            if (error) {
              console.error("Error sending email to user:", error);
              reject(error);
            } else {
              console.log("Email sent to user:", info);
              resolve(info);
            }
          });
        }),
        new Promise((resolve, reject) => {
          transporter.sendMail(adminMailOptions, (error, info) => {
            if (error) {
              console.error("Error sending email to admin:", error);
              reject(error);
            } else {
              console.log("Email sent to admin:", info);
              resolve(info);
            }
          });
        }),
      ]);

      res.status(200).json({
        success: true,
        message: "Submission successful",
      });
    } catch (err) {
      console.error("Upload error:", err);
      if (err.code === 11000 && err.keyPattern && err.keyPattern.orderId) {
        return res.status(409).json({
          success: false,
          message: "Error: Duplicate Claim",
          errorCode: "DUPLICATE_CLAIM",
        });
      }
      res.status(500).json({ 
        success: false, 
        message: "Error: " + err.message 
      });
    }
  } else {
    res.status(400).json({ success: false, message: "Invalid form data" });
  }
});

// Error types for frontend handling
const ErrorTypes = {
  DUPLICATE_CLAIM: 'DUPLICATE_CLAIM',
  INVALID_DATA: 'INVALID_DATA',
  SERVER_ERROR: 'SERVER_ERROR'
};

// Error response helper
const createErrorResponse = (type, message) => ({
  success: false,
  error: {
    type,
    message,
  },
});

app.post("/claim-ticket", async (req, res) => {
  const formData = req.body;

  console.log(formData);
  if (formData) {
    try {
      await connectToDatabase();

      // Handle ASIN - convert array to string if needed
      let asin = formData.asin;
      if (Array.isArray(asin) && asin.length > 0) {
        asin = asin[0]; // Take first ASIN if multiple
      }

      // Generate Amazon URLs if ASIN is provided
      let productUrl = '';
      let reviewUrl = '';
      if (asin) {
        productUrl = `https://www.amazon.com/dp/${asin}`;
        reviewUrl = `https://www.amazon.com/review/create-review?asin=${asin}`;
      }

      const ticketClaim = new TicketClaim({
        ...formData,
        asin: asin,
        productUrl,
      });

      await ticketClaim.save();

      // Create feedback tracker for automated emails
      try {
        const submissionDate = new Date();
        const feedbackTracker = new FeedbackTracker({
          orderId: formData.orderId,
          customerEmail: formData.email,
          customerName: formData.name,
          phoneNumber: formData.phoneNumber,
          asin: asin,
          productName: formData.productName,
          productUrl: productUrl,
          reviewUrl: reviewUrl,
          submissionDate: submissionDate,
          emailSchedule: FeedbackTracker.createScheduledDates(submissionDate),
          status: 'pending',
          isActive: true
        });
        
        await feedbackTracker.save();
        console.log('✓ Feedback tracker created for order:', formData.orderId);
      } catch (trackerError) {
        console.error('Error creating feedback tracker (non-critical):', trackerError);
        // Don't fail the request if tracker creation fails
      }

      // Email to the user
      let userMailOptions = {
        from: process.env.GMAIL_USER,
        to: formData.email,
        subject: "Disney Ticket Draw Entry Confirmation",
        template: "ticket-claim",
        context: {
          name: formData.name,
          socialLinks: {
            instagram: "https://instagram.com/yourhandle",
            facebook: "https://facebook.com/yourpage",
            twitter: "https://twitter.com/yourhandle",
          },
        },
      };

      // Admin notification email
      let adminMailOptions = {
        from: process.env.GMAIL_USER,
        to: process.env.GMAIL_USER,
        subject: "New Disney Ticket Claimed",
        html: DOMPurify.sanitize(`
          <h1>New Ticket Claim Submission</h1>
          ${Object.entries(formData)
            .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`)
            .join("")}
          
        `),
      };

      await Promise.all([
        new Promise((resolve, reject) => {
          transporter.sendMail(userMailOptions, (error, info) => {
            if (error) {
              console.error("Error sending email to user:", error);
              reject(error);
            } else {
              console.log("Email sent to user:", info);
              resolve(info);
            }
          });
        }),
        new Promise((resolve, reject) => {
          transporter.sendMail(adminMailOptions, (error, info) => {
            if (error) {
              console.error("Error sending email to admin:", error);
              reject(error);
            } else {
              console.log("Email sent to admin:", info);
              resolve(info);
            }
          });
        }),
      ]);

      res.status(200).json({
        success: true,
        message: "Ticket claim submitted successfully",
      });
    } catch (err) {
      console.error("Upload error:", err);

      // Handle specific error cases
      if (err.code === 11000 && err.keyPattern && err.keyPattern.orderId) {
        return res
          .status(409)
          .json(
            createErrorResponse(
              ErrorTypes.DUPLICATE_CLAIM,
              "This order ID has already been claimed. Please check your order ID or contact support if you believe this is an error."
            )
          );
      }


      // Handle validation errors
      if (err.name === "ValidationError") {
        return res
          .status(400)
          .json(
            createErrorResponse(
              ErrorTypes.INVALID_DATA,
              "Please check your input data. All fields are required and must be valid."
            )
          );
      }

      // Handle any other errors
      return res
        .status(500)
        .json(
          createErrorResponse(
            ErrorTypes.SERVER_ERROR,
            "An unexpected error occurred. Please try again later."
          )
        );
    }
  } else {
    return res.status(400).json(
      createErrorResponse(
        ErrorTypes.INVALID_DATA,
        "Please provide all required information."
      )
    );
  }
});

// Admin API endpoints for ticket claims
app.get("/api/ticket-claims", async (req, res) => {
  try {
    await connectToDatabase();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { orderId: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    };

    const [claims, total] = await Promise.all([
      TicketClaim.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      TicketClaim.countDocuments(query),
    ]);

    res.status(200).json({
      claims,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching ticket claims:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching ticket claims" });
  }
});

// Admin authentication middleware - Single token approach
const verifyAdminToken = (req, res, next) => {
  const token = req.headers["x-admin-token"] || req.query.token;

  if (!token || token !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(401).render("error", {
      message: "Unauthorized access. Please provide a valid admin token.",
      token: null, // Explicitly set token to null for unauthorized access
    });
  }

  // Add token to res.locals for all subsequent middleware and routes
  res.locals.token = token;
  next();
};

// Delete ticket claim by Order ID (must be after verifyAdminToken)
app.delete("/api/admin/ticket-claims/:orderId", verifyAdminToken, async (req, res) => {
  try {
    await connectToDatabase();
    const orderId = req.params.orderId;
    
    const result = await TicketClaim.deleteOne({ orderId });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Ticket claim not found"
      });
    }
    
    // Also delete associated feedback tracker if exists
    try {
      await FeedbackTracker.deleteOne({ orderId });
      console.log(`Also deleted feedback tracker for order: ${orderId}`);
    } catch (trackerError) {
      console.log(`No feedback tracker found for order: ${orderId}`);
    }
    
    res.status(200).json({
      success: true,
      message: "Ticket claim deleted successfully"
    });
    
  } catch (error) {
    console.error("Error deleting ticket claim:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Admin routes with token verification
app.get("/admin", verifyAdminToken, async (req, res) => {
  try {
    await connectToDatabase();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const skip = (page - 1) * limit;

    // Build query
    const query = {
      $or: [
        { orderId: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    };

    // Add date range if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const [claims, total] = await Promise.all([
      TicketClaim.find(query)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit),
      TicketClaim.countDocuments(query),
    ]);

    res.render("admin/dashboard", {
      claims,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
      search,
      sortBy,
      sortOrder,
      startDate: startDate ? startDate.toISOString().split("T")[0] : "",
      endDate: endDate ? endDate.toISOString().split("T")[0] : "",
      formatDate: (date) => new Date(date).toLocaleString(),
      token: res.locals.token, // Use token from res.locals
    });
  } catch (error) {
    console.error("Error fetching ticket claims:", error);
    res.status(500).render("error", {
      message: "Error fetching ticket claims",
      token: res.locals.token, // Use token from res.locals
    });
  }
});

// Admin route for feedback manager
app.get("/admin/feedback", verifyAdminToken, async (req, res) => {
  try {
    await connectToDatabase();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";
    const status = req.query.status || "";
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerEmail: { $regex: search, $options: "i" } },
      ];
    }

    const [trackers, total] = await Promise.all([
      FeedbackTracker.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      FeedbackTracker.countDocuments(query),
    ]);

    // Get statistics
    const statsArray = await FeedbackTracker.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const stats = {
      total: total,
      pending: 0,
      reviewed: 0,
      unreviewed: 0,
      cancelled: 0,
    };
    statsArray.forEach((s) => {
      stats[s._id] = s.count;
    });

    res.render("admin/feedback-manager", {
      trackers,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
      search,
      status,
      stats,
      token: res.locals.token,
    });
  } catch (error) {
    console.error("Error fetching feedback trackers:", error);
    res.status(500).render("error", {
      message: "Error fetching feedback trackers",
      token: res.locals.token,
    });
  }
});

// Admin route for email template editor
app.get("/admin/feedback/templates", verifyAdminToken, async (req, res) => {
  try {
    res.render("admin/email-templates", {
      token: res.locals.token,
    });
  } catch (error) {
    console.error("Error loading template editor:", error);
    res.status(500).render("error", {
      message: "Error loading template editor",
      token: res.locals.token,
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

app.get("/download-orders", async (req, res) => {
  try {
    await connectToDatabase();
    const orders = await Order.find({});

    if (orders.length === 0) {
      return res.status(404).send("No orders found.");
    }

    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(orders);

    res.header("Content-Type", "text/csv");
    res.attachment("orders.csv");
    res.send(csv);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).send("An error occurred while fetching orders.");
  }
});

// Update download endpoint with token verification and enhanced filtering
app.get("/download-claims", verifyAdminToken, async (req, res) => {
  try {
    await connectToDatabase();
    const format = req.query.format || "csv";
    const search = req.query.search || "";
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    const query = {
      $or: [
        { orderId: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    };

    // Add date range if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const claims = await TicketClaim.find(query).sort({ [sortBy]: sortOrder });

    if (claims.length === 0) {
      return res.status(404).send("No claims found.");
    }

    if (format === "pdf") {
      // Create PDF
      const doc = new PDFDocument();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=claims.pdf");
      doc.pipe(res);

      // Add title and filters
      doc.fontSize(20).text("Ticket Claims Report", { align: "center" });
      doc.moveDown();

      // Add filter information
      doc.fontSize(10);
      if (search) doc.text(`Search: ${search}`, 50, 100);
      if (startDate)
        doc.text(`Start Date: ${startDate.toLocaleDateString()}`, 50, 120);
      if (endDate)
        doc.text(`End Date: ${endDate.toLocaleDateString()}`, 50, 140);
      doc.moveDown();

      // Add table headers
      const headers = ["Order ID", "Name", "Email", "Phone", "Date"];
      let y = 200;
      let x = 50;
      const rowHeight = 30;
      const colWidth = 100;

      // Draw headers
      headers.forEach((header, i) => {
        doc.text(header, x + i * colWidth, y);
      });
      y += rowHeight;

      // Draw data rows
      claims.forEach((claim) => {
        if (y > 700) {
          // Start new page if near bottom
          doc.addPage();
          y = 50;
        }
        doc.text(claim.orderId, x, y);
        doc.text(claim.name, x + colWidth, y);
        doc.text(claim.email, x + colWidth * 2, y);
        doc.text(claim.phoneNumber, x + colWidth * 3, y);
        doc.text(
          new Date(claim.createdAt).toLocaleString(),
          x + colWidth * 4,
          y
        );
        y += rowHeight;
      });

      doc.end();
    } else {
      // Create CSV
      const fields = ["orderId", "name", "email", "phoneNumber", "createdAt"];
      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(claims);

      res.header("Content-Type", "text/csv");
      res.attachment("claims.csv");
      res.send(csv);
    }
  } catch (error) {
    console.error("Error downloading claims:", error);
    res.status(500).send("An error occurred while downloading claims.");
  }
});

// app.listen(5000, function (err) {
//   if (err) console.log("Error in server setup");
//   console.log("Server listening on Port", 5000);
// });

module.exports = app;
