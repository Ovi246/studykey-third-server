const nodemailer = require('nodemailer');
const FeedbackTracker = require('../models/FeedbackTracker');
const EmailTemplate = require('../models/FeedbackTracker').EmailTemplate;
const fs = require('fs');
const path = require('path');

// Check if Gmail credentials are configured
if (!process.env.GMAIL_USER) {
  console.warn('⚠️  WARNING: GMAIL_USER not found in environment variables!');
  console.warn('Emails will fail to send. Please add GMAIL_USER to your .env file.');
}

if (!process.env.GMAIL_PASS) {
  console.warn('⚠️  WARNING: GMAIL_PASS not found in environment variables!');
  console.warn('Emails will fail to send. Please add GMAIL_PASS (App Password) to your .env file.');
}

// Initialize Gmail transporter with Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Verify transporter configuration on startup
if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
  transporter.verify(function(error, success) {
    if (error) {
      console.error('❌ Gmail SMTP verification failed:', error.message);
      console.error('Please check your GMAIL_USER and GMAIL_PASS in .env file');
    } else {
      console.log('✅ Gmail SMTP is ready to send emails');
    }
  });
}

// Rate limiting configuration for Gmail free tier
const RATE_LIMIT = {
  MAX_EMAILS_PER_RUN: 30, // Safe limit for Vercel 10s timeout
  DELAY_BETWEEN_EMAILS: 2000, // 2 seconds delay
  MAX_DAILY_EMAILS: 450 // Gmail allows 500/day, stay under limit
};

// Helper: Sleep function for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Load HTML email template (checks DB first, then falls back to file)
const loadEmailTemplate = async (dayNumber, customerName, productName = '', reviewUrl = '', productUrl = '') => {
  try {
    // Try to load from database first
    const dbTemplate = await EmailTemplate.findOne({ day: dayNumber, isActive: true });
    
    if (dbTemplate && dbTemplate.htmlContent) {
      // Use database template
      let html = dbTemplate.htmlContent;
      html = html.replace(/{{customerName}}/g, customerName);
      html = html.replace(/{{productName}}/g, productName || 'your product');
      html = html.replace(/{{reviewUrl}}/g, reviewUrl || 'https://www.amazon.com/review/create-review');
      html = html.replace(/{{productUrl}}/g, productUrl || 'https://www.amazon.com');
      return html;
    }
  } catch (error) {
    console.log(`No custom template in DB for day ${dayNumber}, using file template`);
  }
  
  // Fall back to file template
  const templatePath = path.join(__dirname, '..', 'views', 'email', `feedback-day${dayNumber}.html`);
  
  try {
    let html = fs.readFileSync(templatePath, 'utf8');
    // Replace placeholders
    html = html.replace(/{{customerName}}/g, customerName);
    html = html.replace(/{{productName}}/g, productName || 'your product');
    html = html.replace(/{{reviewUrl}}/g, reviewUrl || 'https://www.amazon.com/review/create-review');
    html = html.replace(/{{productUrl}}/g, productUrl || 'https://www.amazon.com');
    return html;
  } catch (error) {
    console.error(`Error loading template for day ${dayNumber}:`, error);
    // Fallback to simple text if template not found
    return getDefaultEmailContent(dayNumber, customerName, productName, reviewUrl, productUrl);
  }
};

// Fallback email content
const getDefaultEmailContent = (dayNumber, customerName, productName = '', reviewUrl = '', productUrl = '') => {
  const productDisplay = productName ? productName : 'your product';
  const finalReviewUrl = reviewUrl || 'https://www.amazon.com/review/create-review';
  const finalProductUrl = productUrl || 'https://www.amazon.com';
  
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Hi ${customerName}! 👋</h2>
      
      <p>It's been ${dayNumber} days since you claimed your Study Key reward. We hope you're enjoying <strong>${productDisplay}</strong>!</p>
      
      <p><strong>Would you mind sharing your experience?</strong></p>
      
      <p>Your honest Amazon review helps us improve and helps other customers make informed decisions. It only takes a minute!</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${finalReviewUrl}" 
           style="background-color: #FF9900; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          Write Your Review
        </a>
      </div>
      
      ${productUrl ? `<p style="text-align: center; margin: 20px 0;">
        <a href="${finalProductUrl}" style="color: #0066c0; text-decoration: none;">View ${productDisplay} on Amazon</a>
      </p>` : ''}
      
      <p>Thank you for being part of our community!</p>
      
      <p style="color: #666; font-size: 12px; margin-top: 30px;">
        You're receiving this because you claimed a Study Key reward. If you've already left a review, thank you! You can ignore this email.
      </p>
    </div>
  `;
};

// Get email subject by day (checks DB first, then defaults)
const getEmailSubject = async (dayNumber, customerName) => {
  try {
    const dbTemplate = await EmailTemplate.findOne({ day: dayNumber, isActive: true });
    if (dbTemplate && dbTemplate.subject) {
      return dbTemplate.subject.replace(/{{customerName}}/g, customerName);
    }
  } catch (error) {
    console.log(`No custom subject in DB for day ${dayNumber}, using default`);
  }
  
  // Default subjects
  const subjects = {
    3: `${customerName}, how's your Study Key product? 🎯`,
    7: `Quick favor - Share your Study Key experience? 📝`,
    14: `${customerName}, your feedback matters to us! 💭`,
    30: `Final reminder: Share your Study Key review 🌟`
  };
  return subjects[dayNumber] || `Study Key - Review Request`;
};

/**
 * Send a single feedback email
 */
async function sendFeedbackEmail(tracker, dayNumber) {
  console.log(`\n========================================`);
  console.log(`📧 Attempting to send Day ${dayNumber} email`);
  console.log(`Order ID: ${tracker.orderId}`);
  console.log(`Customer: ${tracker.customerName} <${tracker.customerEmail}>`);
  console.log(`Product: ${tracker.productName || 'N/A'}`);
  console.log(`ASIN: ${tracker.asin || 'N/A'}`);
  console.log(`Review URL: ${tracker.reviewUrl || 'N/A'}`);
  console.log(`========================================`);
  
  try {
    // Check for Gmail configuration
    console.log(`🔍 Checking Gmail configuration...`);
    if (!process.env.GMAIL_USER) {
      const error = 'GMAIL_USER not configured. Cannot send email.';
      console.error(`❌ ${error}`);
      tracker.emailSchedule[`day${dayNumber}`].error = error;
      await tracker.save();
      return { success: false, error: error };
    }
    if (!process.env.GMAIL_PASS) {
      const error = 'GMAIL_PASS not configured. Cannot send email.';
      console.error(`❌ ${error}`);
      tracker.emailSchedule[`day${dayNumber}`].error = error;
      await tracker.save();
      return { success: false, error: error };
    }
    console.log(`✅ GMAIL_USER found: ${process.env.GMAIL_USER}`);
    console.log(`✅ GMAIL_PASS configured: ${process.env.GMAIL_PASS.substring(0, 4)}...`);
    
    console.log(`\n📝 Loading email template...`);
    const emailHtml = await loadEmailTemplate(
      dayNumber, 
      tracker.customerName,
      tracker.productName || '',
      tracker.reviewUrl || '',
      tracker.productUrl || ''
    );
    console.log(`✅ Template loaded (${emailHtml.length} characters)`);
    
    const subject = await getEmailSubject(dayNumber, tracker.customerName);
    console.log(`✅ Subject: "${subject}"`);
    
    console.log(`\n📤 Sending via Gmail SMTP...`);
    console.log(`From: ${process.env.GMAIL_USER}`);
    console.log(`To: ${tracker.customerEmail}`);
    
    // Send email via Gmail
    const info = await transporter.sendMail({
      from: `"Study Key" <${process.env.GMAIL_USER}>`,
      to: tracker.customerEmail,
      subject: subject,
      html: emailHtml
    });
    
    console.log(`\nGmail Response:`, JSON.stringify(info, null, 2));
    
    // Check if email was accepted
    if (!info.accepted || info.accepted.length === 0) {
      const errorMessage = info.rejected ? `Email rejected: ${info.rejected.join(', ')}` : 'Email failed to send';
      
      console.error(`\n❌ Gmail rejected the email!`);
      console.error(`Error: ${errorMessage}`);
      
      // Mark as FAILED (don't mark as sent)
      tracker.emailSchedule[`day${dayNumber}`].error = errorMessage;
      tracker.emailSchedule[`day${dayNumber}`].sent = false;
      await tracker.save();
      console.log(`❌ Marked as FAILED in database (NOT sent)`);
      console.log(`========================================\n`);
      
      return { success: false, error: errorMessage };
    }
    
    console.log(`\n✅ SUCCESS! Email sent via Gmail`);
    console.log(`Message ID: ${info.messageId}`);
    console.log(`Accepted: ${info.accepted.join(', ')}`);
    console.log(`Response: ${info.response}`);
    
    // Mark as sent
    tracker.emailSchedule[`day${dayNumber}`].sent = true;
    tracker.emailSchedule[`day${dayNumber}`].sentAt = new Date();
    tracker.emailSchedule[`day${dayNumber}`].error = null;
    await tracker.save();
    console.log(`✅ Marked as sent in database`);
    
    console.log(`\n✓ Day ${dayNumber} email completed successfully!`);
    console.log(`========================================\n`);
    return { success: true, emailId: info.messageId };
    
  } catch (error) {
    console.error(`\n❌ FAILED to send Day ${dayNumber} email!`);
    console.error(`Error Type: ${error.name}`);
    console.error(`Error Message: ${error.message}`);
    
    // Log detailed error for debugging
    if (error.message) {
      console.error(`📋 Error Details: ${error.message}`);
    }
    if (error.statusCode) {
      console.error(`📊 Status Code: ${error.statusCode}`);
    }
    if (error.response) {
      console.error(`📦 Response:`, JSON.stringify(error.response, null, 2));
    }
    if (error.stack) {
      console.error(`📚 Stack Trace:`);
      console.error(error.stack);
    }
    
    // Log error but DON'T mark as sent (this was the bug!)
    tracker.emailSchedule[`day${dayNumber}`].error = error.message || 'Unknown error';
    tracker.emailSchedule[`day${dayNumber}`].sent = false; // ← Keep as NOT sent
    await tracker.save();
    console.log(`❌ Marked as FAILED in database (NOT sent)`);
    
    console.log(`========================================\n`);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Process all pending emails (called by cron job)
 */
async function processPendingEmails() {
  const startTime = Date.now();
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
  
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow
    
    // Find all active trackers with emails due today
    const trackers = await FeedbackTracker.find({
      isActive: true,
      status: 'pending',
      $or: [
        {
          'emailSchedule.day3.sent': false,
          'emailSchedule.day3.scheduledDate': { $gte: today, $lt: tomorrow }
        },
        {
          'emailSchedule.day7.sent': false,
          'emailSchedule.day7.scheduledDate': { $gte: today, $lt: tomorrow }
        },
        {
          'emailSchedule.day14.sent': false,
          'emailSchedule.day14.scheduledDate': { $gte: today, $lt: tomorrow }
        },
        {
          'emailSchedule.day30.sent': false,
          'emailSchedule.day30.scheduledDate': { $gte: today, $lt: tomorrow }
        }
      ]
    }).limit(RATE_LIMIT.MAX_EMAILS_PER_RUN);
    
    console.log(`Found ${trackers.length} trackers with pending emails for today`);
    
    // Process each tracker
    for (const tracker of trackers) {
      // Check which day to send
      const daysToCheck = [30, 14, 7, 3]; // Priority: later days first
      
      for (const day of daysToCheck) {
        const dayKey = `day${day}`;
        const emailData = tracker.emailSchedule[dayKey];
        
        if (!emailData.sent && 
            emailData.scheduledDate >= today && 
            emailData.scheduledDate < tomorrow) {
          
          results.processed++;
          
          // Send email with rate limiting
          const result = await sendFeedbackEmail(tracker, day);
          
          if (result.success) {
            results.sent++;
          } else {
            results.failed++;
            results.errors.push({
              orderId: tracker.orderId,
              day: day,
              error: result.error
            });
          }
          
          // Rate limiting delay
          if (results.processed < trackers.length) {
            await sleep(RATE_LIMIT.DELAY_BETWEEN_EMAILS);
          }
          
          break; // Only send one email per tracker per run
        }
      }
      
      // Check if we should stop after day 30
      if (tracker.emailSchedule.day30.sent && tracker.status === 'pending') {
        await tracker.markAsUnreviewed();
        console.log(`Marked tracker ${tracker.orderId} as unreviewed (all emails sent, no review)`);
      }
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`\n=== Email Processing Summary ===`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Processed: ${results.processed}`);
    console.log(`Sent: ${results.sent}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Skipped: ${results.skipped}`);
    if (results.errors.length > 0) {
      console.log(`\n❌ Errors:`);
      results.errors.forEach(err => {
        console.log(`  Order: ${err.orderId} | Day: ${err.day} | Error: ${err.error}`);
      });
    }
    console.log(`==============================\n`);
    
    return results;
    
  } catch (error) {
    console.error('Error in processPendingEmails:', error);
    throw error;
  }
}

/**
 * Send a test email (for testing purposes)
 */
async function sendTestEmail(email, name = 'Test User') {
  try {
    const info = await transporter.sendMail({
      from: `"Study Key" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Test Email - Study Key Feedback System',
      html: getDefaultEmailContent(3, name)
    });
    
    return { success: true, emailId: info.messageId };
  } catch (error) {
    console.error('Test email error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendFeedbackEmail,
  processPendingEmails,
  sendTestEmail,
  RATE_LIMIT
};
