const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Email Template Schema for customizable templates
const EmailTemplateSchema = new Schema({
  day: { 
    type: Number, 
    required: true, 
    enum: [3, 7, 14, 30],
    unique: true 
  },
  subject: { 
    type: String, 
    required: true 
  },
  htmlContent: { 
    type: String, 
    required: true 
  },
  lastModified: { 
    type: Date, 
    default: Date.now 
  },
  modifiedBy: String,
  isActive: { 
    type: Boolean, 
    default: true 
  }
});

const FeedbackTrackerSchema = new Schema({
  // Order and Customer Info
  orderId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  customerEmail: { 
    type: String, 
    required: true 
  },
  customerName: { 
    type: String, 
    required: true 
  },
  phoneNumber: String,
  
  // Product Info
  asin: { type: String }, // Product ASIN
  productName: { type: String }, // Product name from Amazon
  productUrl: { type: String }, // Amazon product URL
  reviewUrl: { type: String }, // Amazon review URL
  
  // Submission tracking
  submissionDate: { 
    type: Date, 
    required: true, 
    default: Date.now 
  },
  
  // Email Schedule Status
  emailSchedule: {
    day3: {
      scheduledDate: { type: Date, required: true },
      sent: { type: Boolean, default: false },
      sentAt: { type: Date },
      error: String
    },
    day7: {
      scheduledDate: { type: Date, required: true },
      sent: { type: Boolean, default: false },
      sentAt: { type: Date },
      error: String
    },
    day14: {
      scheduledDate: { type: Date, required: true },
      sent: { type: Boolean, default: false },
      sentAt: { type: Date },
      error: String
    },
    day30: {
      scheduledDate: { type: Date, required: true },
      sent: { type: Boolean, default: false },
      sentAt: { type: Date },
      error: String
    }
  },
  
  // Review Status
  status: { 
    type: String, 
    enum: ['pending', 'reviewed', 'unreviewed', 'cancelled'],
    default: 'pending',
    index: true
  },
  reviewedAt: Date,
  reviewedOnDay: { 
    type: Number, 
    enum: [3, 7, 14, 30]
  },
  
  // Control flags
  isActive: { 
    type: Boolean, 
    default: true,
    index: true
  },
  notes: String,
  
  // Timestamps
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update timestamp on save
FeedbackTrackerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Helper method to calculate scheduled dates
FeedbackTrackerSchema.statics.createScheduledDates = function(submissionDate) {
  const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };
  
  return {
    day3: {
      scheduledDate: addDays(submissionDate, 3),
      sent: false
    },
    day7: {
      scheduledDate: addDays(submissionDate, 7),
      sent: false
    },
    day14: {
      scheduledDate: addDays(submissionDate, 14),
      sent: false
    },
    day30: {
      scheduledDate: addDays(submissionDate, 30),
      sent: false
    }
  };
};

// Method to mark as reviewed and stop emails
FeedbackTrackerSchema.methods.markAsReviewed = function(dayNumber) {
  this.status = 'reviewed';
  this.reviewedAt = new Date();
  this.reviewedOnDay = dayNumber;
  this.isActive = false;
  return this.save();
};

// Method to mark as unreviewed after day 30
FeedbackTrackerSchema.methods.markAsUnreviewed = function() {
  this.status = 'unreviewed';
  this.isActive = false;
  return this.save();
};

// Method to cancel all emails
FeedbackTrackerSchema.methods.cancelEmails = function(notes) {
  this.status = 'cancelled';
  this.isActive = false;
  if (notes) this.notes = notes;
  return this.save();
};

// Indexes for efficient querying
FeedbackTrackerSchema.index({ createdAt: -1 });
FeedbackTrackerSchema.index({ status: 1, isActive: 1 });
FeedbackTrackerSchema.index({ 'emailSchedule.day3.scheduledDate': 1 });
FeedbackTrackerSchema.index({ 'emailSchedule.day7.scheduledDate': 1 });
FeedbackTrackerSchema.index({ 'emailSchedule.day14.scheduledDate': 1 });
FeedbackTrackerSchema.index({ 'emailSchedule.day30.scheduledDate': 1 });

let FeedbackTracker;
let EmailTemplate;

if (mongoose.models.FeedbackTracker) {
  FeedbackTracker = mongoose.model("FeedbackTracker");
} else {
  FeedbackTracker = mongoose.model("FeedbackTracker", FeedbackTrackerSchema);
}

if (mongoose.models.EmailTemplate) {
  EmailTemplate = mongoose.model("EmailTemplate");
} else {
  EmailTemplate = mongoose.model("EmailTemplate", EmailTemplateSchema);
}

module.exports = FeedbackTracker;
module.exports.EmailTemplate = EmailTemplate;
