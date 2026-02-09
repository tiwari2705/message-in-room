# Setup Guide for Classroom Chat Rooms

This guide will walk you through setting up the project from scratch.

## Step 1: Clone and Install

```bash
# Navigate to the project directory
cd message

# Install all dependencies
npm install
```

## Step 2: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in:
   - Project name: `classroom-chat` (or any name you prefer)
   - Database password: Choose a strong password
   - Region: Select closest to your location
5. Wait for the project to be created (takes ~2 minutes)

## Step 3: Get Supabase Credentials

1. In your Supabase project dashboard, click on "Project Settings" (gear icon in sidebar)
2. Go to "API" section
3. You'll see:
   - **Project URL**: Copy this (looks like `https://xxxxx.supabase.co`)
   - **Project API keys**: 
     - Copy the `service_role` key (NOT the `anon` key)
     - ⚠️ Keep this secret! Never commit it to git

## Step 4: Create Environment File

Create a file named `.env` in the project root directory:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
SESSION_SECRET=generate-a-random-string-here
PORT=3000
```

Replace:
- `SUPABASE_URL` with your Project URL from Step 3
- `SUPABASE_SERVICE_KEY` with your service_role key from Step 3
- `SESSION_SECRET` with any random string (e.g., `my-super-secret-key-12345`)

## Step 5: Set Up Database Tables

1. In your Supabase dashboard, click on "SQL Editor" in the sidebar
2. Click "New Query"
3. Open the `supabase-schema.sql` file in this project
4. Copy ALL the contents
5. Paste into the SQL Editor
6. Click "Run" button (or press Ctrl+Enter)
7. You should see "Success. No rows returned" message

This creates:
- `users` table
- `rooms` table
- `room_memberships` table
- `messages` table
- `polls` table
- All necessary indexes and triggers

## Step 6: Verify Database Setup

1. In Supabase dashboard, click "Table Editor" in sidebar
2. You should see 5 tables listed:
   - users
   - rooms
   - room_memberships
   - messages
   - polls

## Step 7: Start the Server

```bash
npm start
```

You should see:
```
Server listening on http://localhost:3000
```

## Step 8: Test the Application

1. Open your browser to `http://localhost:3000`
2. Enter a username (e.g., "Alice")
3. Click "Create Room"
4. You should be redirected to a chat room with a 6-character code
5. Open another browser tab (or incognito window)
6. Enter a different username (e.g., "Bob")
7. Enter the room code from step 4
8. Click "Join Room"
9. Try sending messages between the two users!

## Troubleshooting

### Error: "supabaseUrl is required"
- Make sure your `.env` file exists in the project root
- Check that `SUPABASE_URL` is set correctly
- Restart the server after creating/editing `.env`

### Error: "Failed to create room" or database errors
- Make sure you ran the SQL schema from `supabase-schema.sql`
- Check that all 5 tables exist in Supabase Table Editor
- Verify you're using the `service_role` key, not the `anon` key

### Error: PathError with route '*'
- This has been fixed in the latest version
- Make sure you have the updated `server.js` with `app.get('/(.*)', ...)`

### Socket.IO not working / No real-time updates
- This has been fixed with the new `socketHandlers.js` file
- Make sure `socketHandlers.js` exists in your project root
- Check that `server.js` imports and calls `setupSocketHandlers(io)`

### Port already in use
- Change the `PORT` in your `.env` file to a different number (e.g., 3001)
- Or stop any other process using port 3000

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never commit `.env` to git**
   - The `.env` file is already in `.gitignore`
   - Never share your `SUPABASE_SERVICE_KEY` publicly

2. **Service Role Key**
   - The service role key bypasses Row Level Security (RLS)
   - Only use it on the server-side, never expose to clients
   - For production, consider using more restrictive RLS policies

3. **Session Secret**
   - Use a strong, random string for `SESSION_SECRET`
   - Change it for production deployments

## Next Steps

- Customize the room duration in `socketHandlers.js` (default: 30 minutes)
- Modify the UI in `public/styles.css`
- Add more features like file uploads, voice chat, etc.
- Deploy to a hosting service (Heroku, Railway, Render, etc.)

## Need Help?

If you encounter issues:
1. Check the console for error messages
2. Verify all environment variables are set correctly
3. Make sure the database schema was created successfully
4. Check that all dependencies are installed (`npm install`)
