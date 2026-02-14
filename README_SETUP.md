# Email Autoresponder System Setup Guide

## Overview
This guide explains how to implement and configure the automated email responder system that sends follow-up emails to customers on Day 3, 7, 14, and 30 after they submit their order.

## Features
- Automated email sequences (Days 3, 7, 14, 30)
- Email tracking (open/click rates)
- Admin dashboard for monitoring
- Customizable email templates
- Integration with existing TicketClaim system
- SendGrid for reliable delivery

## Prerequisites
- Node.js v16+ 
- MongoDB Atlas account
- SendGrid account
- Vercel account for deployment

## Setup Steps

### 1. Install Dependencies
```bash
npm install @sendgrid/mail
```

### 2. Environment Variables
Add the following to your `.env` file:

```env
# SendGrid Configuration (for automated feedback emails)
# Sign up at https://sendgrid.com - Free tier: 100 emails/day
# 1. Create account at https://sendgrid.com
# 2. Go to Settings > API Keys > Create API Key (Full Access)
# 3. Go to Settings > Sender Authentication > Verify a Single Sender
SENDGRID_API_KEY=SG.your-sendgrid-api-key-here
SENDGRID_FROM_EMAIL=your-verified-sender@example.com
SENDGRID_FROM_NAME=Your Company Name

# Vercel Cron Secret
# Generate a strong random string for cron job authentication
CRON_SECRET=your-super-secret-cron-token-here
```

### 3. Database Models
Create the FeedbackTracker model with email scheduling functionality:

```javascript
// models/FeedbackTracker.js
// (Use the code from IMPLEMENTATION_INSTRUCTIONS.md)
```

### 4. Email Service
Create the email scheduler service:

```javascript
// services/emailScheduler.js
// (Use the code from IMPLEMENTATION_INSTRUCTIONS.md)
```

### 5. Cron Job Endpoint
Create the cron job handler:

```javascript
// api/cron/process-emails.js
// (Use the code from IMPLEMENTATION_INSTRUCTIONS.md)
```

### 6. Email Templates
Create HTML email templates for each day:

- `views/email/feedback-day3.html`
- `views/email/feedback-day7.html`
- `views/email/feedback-day14.html`
- `views/email/feedback-day30.html`

### 7. Admin Routes
Add admin API routes for managing the email system:

```javascript
// routes/admin/feedback.js
// (Use the code from IMPLEMENTATION_INSTRUCTIONS.md)
```

### 8. Update Main Application
In your main `index.js`, integrate the new system:

```javascript
// Import the email scheduler
const { processPendingEmails, sendFeedbackEmail } = require('./services/emailScheduler');

// Import the FeedbackTracker model
const FeedbackTracker = require('./models/FeedbackTracker');

// In your claim-ticket endpoint, add feedback tracker creation:
app.post("/claim-ticket", async (req, res) => {

  // Create feedback tracker for automated emails
  try {
    const submissionDate = new Date();
    const feedbackTracker = new FeedbackTracker({
      orderId: formData.orderId,
      customerEmail: formData.email,
      customerName: formData.name,
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

  // ... rest of existing code ...
});
```

### 9. Vercel Configuration
Update `vercel.json` to include the cron endpoint:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.js",
      "use": "@vercel/node"
    },
    {
      "src": "api/cron/process-emails.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/cron/process-emails",
      "dest": "/api/cron/process-emails.js"
    },
    {
      "src": "/(.*)",
      "dest": "/index.js",
      "methods": ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      "headers": {
        "Access-Control-Allow-Origin": "https://your-frontend-domain.vercel.app",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
      }
    }
  ]
}
```

### 10. External Cron Service Setup (cron-job.org)

Since Vercel free tier only allows 2 cron jobs, we'll use an external service:

1. Sign up at https://cron-job.org
2. Create a new cron job with these settings:
   - **URL**: `https://your-vercel-domain.vercel.app/api/cron/process-emails`
   - **Schedule**: Every 4 hours (6 times/day) - `0 */4 * * *`
   - **Request Method**: GET
   - **Headers**:
     - Name: `Authorization`
     - Value: `Bearer your-cron-secret-token-here`

### 11. Admin Dashboard
Add links to your admin dashboard for managing the email system:

```html
<!-- In your admin dashboard -->
<a href="/admin/feedback" class="btn btn-primary">Feedback Manager</a>
<a href="/admin/feedback/templates" class="btn btn-secondary">Email Templates</a>
```

## Email Sequence Logic

The system works as follows:

1. **Day 0** (Order Submitted): Feedback tracker is created with scheduled dates for Days 3, 7, 14, and 30
2. **Day 3**: First follow-up email is sent
3. **Day 7**: Second follow-up email is sent
4. **Day 14**: Third follow-up email is sent
5. **Day 30**: Final follow-up email is sent
6. **After Day 30**: If no review received, status changes to "unreviewed"

## Monitoring and Management

- Access the feedback manager at `/admin/feedback`
- Monitor email statistics and tracker statuses
- Update customer statuses (reviewed, cancelled, etc.)
- Edit email templates through the template editor
- View email performance metrics

## Best Practices

1. **SendGrid Setup**: Always verify your sender email in SendGrid dashboard
2. **Cron Security**: Use strong secrets for cron authentication
3. **Rate Limiting**: The system handles Vercel's timeout constraints automatically
4. **Testing**: Use the test email functionality in the admin dashboard
5. **Monitoring**: Regularly check the admin dashboard for failed emails

## Troubleshooting

- **Emails not sending**: Check SendGrid API key and sender authentication
- **Cron not running**: Verify cron-job.org configuration and Vercel logs
- **Database errors**: Ensure MongoDB connection is stable
- **Rate limiting**: The system automatically handles Vercel's timeout constraints