// Quick test to verify Supabase connection and tables
require('dotenv').config();
const { supabase } = require('./supabaseClient');

async function testDatabase() {
  console.log('Testing Supabase connection...\n');
  
  // Test 1: Check connection
  console.log('1. Testing connection...');
  const { data: testData, error: testError } = await supabase
    .from('users')
    .select('count');
  
  if (testError) {
    console.error('❌ Connection failed:', testError.message);
    console.error('\nMake sure you have:');
    console.error('1. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    console.error('2. Run the SQL schema from supabase-schema.sql in your Supabase dashboard');
    return;
  }
  
  console.log('✅ Connection successful!\n');
  
  // Test 2: Check tables exist
  console.log('2. Checking if tables exist...');
  const tables = ['users', 'rooms', 'room_memberships', 'messages', 'polls'];
  
  for (const table of tables) {
    const { error } = await supabase.from(table).select('count').limit(0);
    if (error) {
      console.error(`❌ Table "${table}" not found or not accessible`);
      console.error('   Error:', error.message);
    } else {
      console.log(`✅ Table "${table}" exists`);
    }
  }
  
  console.log('\n3. Database setup complete!');
  console.log('You can now run: npm start');
}

testDatabase().catch(console.error);
