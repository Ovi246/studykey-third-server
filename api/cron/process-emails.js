const { processPendingEmails } = require('../../services/emailScheduler');

/**
 * Vercel Cron Job Handler
 * Runs daily at 9 AM UTC to process pending feedback emails
 * 
 * Vercel Cron Schedule: 0 9 * * * (Daily at 9 AM UTC)
 */
module.exports = async (req, res) => {
  // Verify this is a valid cron request
  const authHeader = req.headers['authorization'];
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedAuth) {
    console.error('Unauthorized cron request');
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized' 
    });
  }
  
  console.log('\n🔄 Starting email processing cron job...');
  console.log(`Time: ${new Date().toISOString()}`);
  
  try {
    const results = await processPendingEmails();
    
    console.log('✓ Cron job completed successfully\n');
    
    return res.status(200).json({
      success: true,
      message: 'Email processing completed',
      results: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('✗ Cron job failed:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
