const express = require("express");
const geoip = require("fast-geoip");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const SellingPartnerAPI = require("amazon-sp-api");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { Parser } = require("json2csv");
const ejs = require("ejs");
const PDFDocument = require('pdfkit');

// Update multer configuration to handle multiple upload types
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Create separate upload handlers for different routes
const uploadReviewScreenshot = upload.single('reviewScreenshot');
const uploadMedia = upload.single('media');

const app = express();

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
require("dotenv").config();

const cors = require("cors");
const allowedOrigins = [
  "https://study-key-reward.vercel.app",
  "http://localhost:5173",
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
  createdAt: { type: Date, default: Date.now },
  reviewMedia: String,
  reviewType: {
    type: String,
    enum: ['image', 'video'],
    required: true
  },
});

const TicketClaimSchema = new Schema({
  orderId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  reviewScreenshot: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

let Order;
let TicketClaim;

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

      // Extract the ASINs from the order items
      const asins = orderItems.OrderItems.map((item) => item.ASIN);

      res.status(200).send({ valid: true, asins: asins });
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

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Add a helper function to handle media uploads
async function uploadToCloudinary(file, type) {
  const b64 = Buffer.from(file.buffer).toString('base64');
  const dataURI = `data:${file.mimetype};base64,${b64}`;
  
  return await cloudinary.uploader.upload(dataURI, {
    folder: type === 'video' ? 'review-videos' : 'review-screenshots',
    resource_type: 'auto',
    public_id: `review-${Date.now()}`,
    // Add specific options for videos
    ...(type === 'video' && {
      chunk_size: 6000000, // 6MB chunks
      eager: [
        { width: 720, height: 480, crop: "pad" }, // Lower resolution version
      ],
      eager_async: true,
    })
  });
}

app.post("/submit-review", uploadMedia, async (req, res) => {
  const formData = req.body;

  if (formData) {
    try {
      await connectToDatabase();

      /// Handle media upload if present
      let mediaUrl = null;
      if (req.file) {
        const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
        const result = await uploadToCloudinary(req.file, mediaType);
        mediaUrl = result.secure_url;
      }

      const order = new Order({
        ...formData,
        reviewStatus: "pending",
        reviewMedia: mediaUrl,
        reviewType: req.file?.mimetype.startsWith('video/') ? 'video' : 'image',
        reviewSubmittedAt: new Date(),
      });

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

      // Update admin email to include media
      let adminMailOptions = {
        from: process.env.GMAIL_USER,
        to: process.env.GMAIL_USER,
        subject: "New Testimonial Claimed",
        html: DOMPurify.sanitize(`
          <h1>New Order Submission</h1>
          ${Object.entries(formData)
            .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`)
            .join("")}
          ${
            mediaUrl
              ? `<p><strong>Review ${req.file?.mimetype.startsWith('video/') ? 'Video' : 'Screenshot'}:</strong> 
                 <a href="${mediaUrl}">View Media</a></p>`
              : ""
          }
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
        mediaUrl: mediaUrl,
      });
    } catch (err) {
      console.error('Upload error:', err);
      if (err.code === 11000 && err.keyPattern && err.keyPattern.orderId) {
        return res.status(409).json({
          success: false,
          message: "Error: Duplicate Claim",
          errorCode: "DUPLICATE_CLAIM",
        });
      }
      res.status(500).json({ 
        success: false, 
        message: err.message.includes('file size') 
          ? "File size too large. Please upload a smaller file."
          : "Error: " + err.message 
      });
    }
  } else {
    res.status(400).json({ success: false, message: "Invalid form data" });
  }
});

// Error types for frontend handling
const ErrorTypes = {
  DUPLICATE_CLAIM: 'DUPLICATE_CLAIM',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_DATA: 'INVALID_DATA',
  SERVER_ERROR: 'SERVER_ERROR'
};

// Error response helper
const createErrorResponse = (type, message) => ({
  success: false,
  error: {
    type,
    message
  }
});

app.post("/claim-ticket", uploadReviewScreenshot, async (req, res) => {
  const formData = req.body;

  if (formData && req.file) {
    try {
      await connectToDatabase();

      // Upload screenshot to Cloudinary
      const result = await uploadToCloudinary(req.file, 'image');
      const screenshotUrl = result.secure_url;

      const ticketClaim = new TicketClaim({
        ...formData,
        reviewScreenshot: screenshotUrl,
      });

      await ticketClaim.save();

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
            twitter: "https://twitter.com/yourhandle"
          }
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
          <p><strong>Review Screenshot:</strong> <a href="${screenshotUrl}">View Screenshot</a></p>
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
        screenshotUrl: screenshotUrl,
      });
    } catch (err) {
      console.error('Upload error:', err);
      
      // Handle specific error cases
      if (err.code === 11000 && err.keyPattern && err.keyPattern.orderId) {
        return res.status(409).json(
          createErrorResponse(
            ErrorTypes.DUPLICATE_CLAIM,
            "This order ID has already been claimed. Please check your order ID or contact support if you believe this is an error."
          )
        );
      }

      if (err.message && err.message.includes('file size')) {
        return res.status(400).json(
          createErrorResponse(
            ErrorTypes.FILE_TOO_LARGE,
            "The file size is too large. Please upload a file smaller than 100MB."
          )
        );
      }

      // Handle validation errors
      if (err.name === 'ValidationError') {
        return res.status(400).json(
          createErrorResponse(
            ErrorTypes.INVALID_DATA,
            "Please check your input data. All fields are required and must be valid."
          )
        );
      }

      // Handle any other errors
      return res.status(500).json(
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
        "Please provide all required information and a screenshot."
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
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { orderId: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    };

    const [claims, total] = await Promise.all([
      TicketClaim.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      TicketClaim.countDocuments(query)
    ]);

    res.status(200).json({
      claims,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching ticket claims:", error);
    res.status(500).json({ success: false, message: "Error fetching ticket claims" });
  }
});

// Admin authentication middleware
const verifyAdminToken = (req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  
  if (!token || token !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(401).render('error', { 
      message: "Unauthorized access. Please provide a valid admin token.",
      token: null // Explicitly set token to null for unauthorized access
    });
  }
  
  // Add token to res.locals for all subsequent middleware and routes
  res.locals.token = token;
  next();
};

// Admin routes with token verification
app.get("/admin", verifyAdminToken, async (req, res) => {
  try {
    await connectToDatabase();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const skip = (page - 1) * limit;

    // Build query
    const query = {
      $or: [
        { orderId: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
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
      TicketClaim.countDocuments(query)
    ]);

    res.render('admin/dashboard', {
      claims,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      },
      search,
      sortBy,
      sortOrder,
      startDate: startDate ? startDate.toISOString().split('T')[0] : '',
      endDate: endDate ? endDate.toISOString().split('T')[0] : '',
      formatDate: (date) => new Date(date).toLocaleString(),
      token: res.locals.token // Use token from res.locals
    });
  } catch (error) {
    console.error("Error fetching ticket claims:", error);
    res.status(500).render('error', { 
      message: "Error fetching ticket claims",
      token: res.locals.token // Use token from res.locals
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
    const format = req.query.format || 'csv';
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    
    const query = {
      $or: [
        { orderId: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    };

    // Add date range if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const claims = await TicketClaim.find(query)
      .sort({ [sortBy]: sortOrder });

    if (claims.length === 0) {
      return res.status(404).send("No claims found.");
    }

    if (format === 'pdf') {
      // Create PDF
      const doc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=claims.pdf');
      doc.pipe(res);

      // Add title and filters
      doc.fontSize(20).text('Ticket Claims Report', { align: 'center' });
      doc.moveDown();
      
      // Add filter information
      doc.fontSize(10);
      if (search) doc.text(`Search: ${search}`, 50, 100);
      if (startDate) doc.text(`Start Date: ${startDate.toLocaleDateString()}`, 50, 120);
      if (endDate) doc.text(`End Date: ${endDate.toLocaleDateString()}`, 50, 140);
      doc.moveDown();

      // Add table headers
      const headers = ['Order ID', 'Name', 'Email', 'Phone', 'Date'];
      let y = 200;
      let x = 50;
      const rowHeight = 30;
      const colWidth = 100;

      // Draw headers
      headers.forEach((header, i) => {
        doc.text(header, x + (i * colWidth), y);
      });
      y += rowHeight;

      // Draw data rows
      claims.forEach(claim => {
        if (y > 700) { // Start new page if near bottom
          doc.addPage();
          y = 50;
        }
        doc.text(claim.orderId, x, y);
        doc.text(claim.name, x + colWidth, y);
        doc.text(claim.email, x + (colWidth * 2), y);
        doc.text(claim.phoneNumber, x + (colWidth * 3), y);
        doc.text(new Date(claim.createdAt).toLocaleString(), x + (colWidth * 4), y);
        y += rowHeight;
      });

      doc.end();
    } else {
      // Create CSV
      const fields = ['orderId', 'name', 'email', 'phoneNumber', 'createdAt'];
      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(claims);

      res.header('Content-Type', 'text/csv');
      res.attachment('claims.csv');
      res.send(csv);
    }
  } catch (error) {
    console.error("Error downloading claims:", error);
    res.status(500).send("An error occurred while downloading claims.");
  }
});

app.listen(5000, function (err) {
  if (err) console.log("Error in server setup");
  console.log("Server listening on Port", 5000);
});

module.exports = app;