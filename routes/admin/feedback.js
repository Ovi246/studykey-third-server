const express = require('express');
const router = express.Router();
const FeedbackTracker = require('../../models/FeedbackTracker');
const EmailTemplate = require('../../models/FeedbackTracker').EmailTemplate;
const fs = require('fs');
const path = require('path');

// Simple admin authentication middleware - Single token approach
const verifyAdminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.token;
  
  if (!token || token !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Invalid admin token.'
    });
  }
  
  next();
};

/**
 * GET /api/admin/feedback-trackers
 * Get all feedback trackers with filtering and pagination
 */
router.get('/feedback-trackers', verifyAdminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status; // pending, reviewed, unreviewed, cancelled
    const search = req.query.search || '';
    
    // Build query
    const query = {};
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } }
      ];
    }
    
    const [trackers, total] = await Promise.all([
      FeedbackTracker.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      FeedbackTracker.countDocuments(query)
    ]);
    
    // Get statistics
    const stats = await FeedbackTracker.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const statsObj = {
      total: total,
      pending: 0,
      reviewed: 0,
      unreviewed: 0,
      cancelled: 0
    };
    stats.forEach(s => {
      statsObj[s._id] = s.count;
    });
    
    res.json({
      success: true,
      trackers,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      },
      stats: statsObj
    });
    
  } catch (error) {
    console.error('Error fetching feedback trackers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/feedback-trackers/:orderId
 * Get single feedback tracker by order ID
 */
router.get('/feedback-trackers/:orderId', verifyAdminAuth, async (req, res) => {
  try {
    const tracker = await FeedbackTracker.findOne({ 
      orderId: req.params.orderId 
    });
    
    if (!tracker) {
      return res.status(404).json({
        success: false,
        error: 'Feedback tracker not found'
      });
    }
    
    res.json({
      success: true,
      tracker
    });
    
  } catch (error) {
    console.error('Error fetching feedback tracker:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/feedback-trackers/:orderId/mark-reviewed
 * Mark a tracker as reviewed (stops all future emails)
 */
router.put('/feedback-trackers/:orderId/mark-reviewed', verifyAdminAuth, async (req, res) => {
  try {
    const { dayNumber } = req.body; // 3, 7, 14, or 30
    
    const tracker = await FeedbackTracker.findOne({ 
      orderId: req.params.orderId 
    });
    
    if (!tracker) {
      return res.status(404).json({
        success: false,
        error: 'Feedback tracker not found'
      });
    }
    
    await tracker.markAsReviewed(dayNumber);
    
    res.json({
      success: true,
      message: 'Tracker marked as reviewed. All future emails cancelled.',
      tracker
    });
    
  } catch (error) {
    console.error('Error marking as reviewed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/feedback-trackers/:orderId/mark-unreviewed
 * Manually mark a tracker as unreviewed
 */
router.put('/feedback-trackers/:orderId/mark-unreviewed', verifyAdminAuth, async (req, res) => {
  try {
    const tracker = await FeedbackTracker.findOne({ 
      orderId: req.params.orderId 
    });
    
    if (!tracker) {
      return res.status(404).json({
        success: false,
        error: 'Feedback tracker not found'
      });
    }
    
    await tracker.markAsUnreviewed();
    
    res.json({
      success: true,
      message: 'Tracker marked as unreviewed',
      tracker
    });
    
  } catch (error) {
    console.error('Error marking as unreviewed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/feedback-trackers/:orderId/cancel
 * Cancel all emails for a tracker
 */
router.put('/feedback-trackers/:orderId/cancel', verifyAdminAuth, async (req, res) => {
  try {
    const { notes } = req.body;
    
    const tracker = await FeedbackTracker.findOne({ 
      orderId: req.params.orderId 
    });
    
    if (!tracker) {
      return res.status(404).json({
        success: false,
        error: 'Feedback tracker not found'
      });
    }
    
    await tracker.cancelEmails(notes);
    
    res.json({
      success: true,
      message: 'All emails cancelled for this tracker',
      tracker
    });
    
  } catch (error) {
    console.error('Error cancelling emails:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/feedback-trackers/:orderId/reactivate
 * Reactivate a cancelled tracker
 */
router.put('/feedback-trackers/:orderId/reactivate', verifyAdminAuth, async (req, res) => {
  try {
    const tracker = await FeedbackTracker.findOne({ 
      orderId: req.params.orderId 
    });
    
    if (!tracker) {
      return res.status(404).json({
        success: false,
        error: 'Feedback tracker not found'
      });
    }
    
    tracker.isActive = true;
    tracker.status = 'pending';
    await tracker.save();
    
    res.json({
      success: true,
      message: 'Tracker reactivated',
      tracker
    });
    
  } catch (error) {
    console.error('Error reactivating tracker:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/admin/feedback-trackers/:orderId
 * Delete a feedback tracker (use with caution)
 */
router.delete('/feedback-trackers/:orderId', verifyAdminAuth, async (req, res) => {
  try {
    const result = await FeedbackTracker.deleteOne({ 
      orderId: req.params.orderId 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feedback tracker not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Feedback tracker deleted'
    });
    
  } catch (error) {
    console.error('Error deleting tracker:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/feedback-stats
 * Get dashboard statistics
 */
router.get('/feedback-stats', verifyAdminAuth, async (req, res) => {
  try {
    const stats = await FeedbackTracker.aggregate([
      {
        $facet: {
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ],
          byDay: [
            {
              $group: {
                _id: '$reviewedOnDay',
                count: { $sum: 1 }
              }
            }
          ],
          emailsSent: [
            {
              $project: {
                day3Sent: { $cond: ['$emailSchedule.day3.sent', 1, 0] },
                day7Sent: { $cond: ['$emailSchedule.day7.sent', 1, 0] },
                day14Sent: { $cond: ['$emailSchedule.day14.sent', 1, 0] },
                day30Sent: { $cond: ['$emailSchedule.day30.sent', 1, 0] }
              }
            },
            {
              $group: {
                _id: null,
                day3: { $sum: '$day3Sent' },
                day7: { $sum: '$day7Sent' },
                day14: { $sum: '$day14Sent' },
                day30: { $sum: '$day30Sent' }
              }
            }
          ]
        }
      }
    ]);
    
    res.json({
      success: true,
      stats: stats[0]
    });
    
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/email-templates
 * Get all email templates
 */
router.get('/email-templates', verifyAdminAuth, async (req, res) => {
  try {
    let templates = await EmailTemplate.find().sort({ day: 1 });
    
    // If no templates in DB, load from files
    if (templates.length === 0) {
      const days = [3, 7, 14, 30];
      templates = [];
      
      for (const day of days) {
        const filePath = path.join(__dirname, '..', '..', 'views', 'email', `feedback-day${day}.html`);
        try {
          const htmlContent = fs.readFileSync(filePath, 'utf8');
          
          // Extract subject from default logic
          const subjects = {
            3: '{{customerName}}, how\'s your Study Key product? 🎯',
            7: 'Quick favor - Share your Study Key experience? 📝',
            14: '{{customerName}}, your feedback matters to us! 💭',
            30: 'Final reminder: Share your Study Key review 🌟'
          };
          
          templates.push({
            day,
            subject: subjects[day],
            htmlContent,
            isActive: false,
            isFromFile: true
          });
        } catch (error) {
          console.error(`Error loading template file for day ${day}:`, error);
        }
      }
    }
    
    res.json({
      success: true,
      templates
    });
    
  } catch (error) {
    console.error('Error fetching email templates:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/email-templates/:day
 * Get single email template
 */
router.get('/email-templates/:day', verifyAdminAuth, async (req, res) => {
  try {
    const day = parseInt(req.params.day);
    
    let template = await EmailTemplate.findOne({ day });
    
    // If not in DB, load from file
    if (!template) {
      const filePath = path.join(__dirname, '..', '..', 'views', 'email', `feedback-day${day}.html`);
      try {
        const htmlContent = fs.readFileSync(filePath, 'utf8');
        
        const subjects = {
          3: '{{customerName}}, how\'s your Study Key product? 🎯',
          7: 'Quick favor - Share your Study Key experience? 📝',
          14: '{{customerName}}, your feedback matters to us! 💭',
          30: 'Final reminder: Share your Study Key review 🌟'
        };
        
        template = {
          day,
          subject: subjects[day],
          htmlContent,
          isActive: false,
          isFromFile: true
        };
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }
    }
    
    res.json({
      success: true,
      template
    });
    
  } catch (error) {
    console.error('Error fetching email template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/admin/email-templates/:day
 * Update or create email template
 */
router.put('/email-templates/:day', verifyAdminAuth, async (req, res) => {
  try {
    const day = parseInt(req.params.day);
    const { subject, htmlContent, isActive } = req.body;
    
    if (!subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        error: 'Subject and htmlContent are required'
      });
    }
    
    let template = await EmailTemplate.findOne({ day });
    
    if (template) {
      // Update existing
      template.subject = subject;
      template.htmlContent = htmlContent;
      template.isActive = isActive !== undefined ? isActive : true;
      template.lastModified = new Date();
      await template.save();
    } else {
      // Create new
      template = new EmailTemplate({
        day,
        subject,
        htmlContent,
        isActive: isActive !== undefined ? isActive : true
      });
      await template.save();
    }
    
    res.json({
      success: true,
      message: 'Email template updated successfully',
      template
    });
    
  } catch (error) {
    console.error('Error updating email template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/email-templates/:day/reset
 * Reset template to default (delete custom from DB)
 */
router.post('/email-templates/:day/reset', verifyAdminAuth, async (req, res) => {
  try {
    const day = parseInt(req.params.day);
    
    await EmailTemplate.deleteOne({ day });
    
    res.json({
      success: true,
      message: 'Email template reset to default'
    });
    
  } catch (error) {
    console.error('Error resetting email template:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
