const { processPendingEmails } = require('../../services/emailScheduler');

/**
 * Vercel Cron Job Handler
 * Runs daily at 9 AM UTC to process pending feedback emails
 * 
 * Vercel Cron Schedule: 0 9 * * * (Daily at 9 AM UTC)
 */
module.exports = async (req, res) => {
  const startTime = Date.now();
  
  // Log immediately to show cron started
  console.log('========================================');
  console.log('🔄 CRON JOB STARTED');
  console.log('Time:', new Date().toISOString());
  console.log('Path:', req.url);
  console.log('Method:', req.method);
  console.log('========================================');
  
  // Verify this is a valid cron request
  const authHeader = req.headers['authorization'];
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
  
  if (!process.env.CRON_SECRET) {
    console.error('❌ CRON_SECRET not configured in environment variables!');
    return res.status(500).json({ 
      success: false, 
      error: 'CRON_SECRET not configured',
      timestamp: new Date().toISOString()
    });
  }
  
  if (authHeader !== expectedAuth) {
    console.error('❌ Unauthorized cron request');
    console.error('Received auth:', authHeader ? 'Bearer ***' : 'None');
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized',
      timestamp: new Date().toISOString()
    });
  }
  
  console.log('✅ Authorization verified');
  console.log('\n📧 Starting email processing...');
  
  try {
    const results = await processPendingEmails();
    
    const duration = Date.now() - startTime;
    
    console.log('\n========================================');
    console.log('✅ CRON JOB COMPLETED SUCCESSFULLY');
    console.log('Duration:', duration + 'ms');
    console.log('Processed:', results.processed);
    console.log('Sent:', results.sent);
    console.log('Failed:', results.failed);
    console.log('Skipped:', results.skipped);
    if (results.errors && results.errors.length > 0) {
      console.log('Errors:', JSON.stringify(results.errors, null, 2));
    }
    console.log('========================================\n');
    
    return res.status(200).json({
      success: true,
      message: 'Email processing completed',
      results: results,
      duration: duration,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('\n========================================');
    console.error('❌ CRON JOB FAILED');
    console.error('Duration:', duration + 'ms');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('========================================\n');
    
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      duration: duration,
      timestamp: new Date().toISOString()
    });
  }
};
