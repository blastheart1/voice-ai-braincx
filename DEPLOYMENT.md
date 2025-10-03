# 🚀 Deployment Guide

This guide covers deploying the Voice AI Conversational Agent to production using Render (backend) and Vercel (frontend).

## 📋 Prerequisites

- GitHub repository with your code
- Render account (free tier available)
- Vercel account (free tier available)
- OpenAI API key
- LiveKit account and credentials

## 🔧 Backend Deployment (Render)

### 1. Prepare Environment Variables

You'll need these environment variables in Render:

```
OPENAI_API_KEY=your_openai_api_key_here
LIVEKIT_URL=wss://your-livekit-url.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
PORT=10000
```

### 2. Deploy to Render

1. **Connect Repository**:
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Service**:
   - **Name**: `voice-ai-backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && python main.py`
   - **Plan**: Free (or paid for better performance)

3. **Set Environment Variables**:
   - Add all the environment variables listed above
   - Make sure to use your actual API keys

4. **Deploy**:
   - Click "Create Web Service"
   - Wait for deployment to complete
   - Note your backend URL (e.g., `https://voice-ai-backend.onrender.com`)

### 3. Health Check

Your backend includes a health check endpoint at `/health` that Render will use to verify the service is running.

## 🌐 Frontend Deployment (Vercel)

### 1. Update Backend URL

The frontend is already configured to use environment variables. Update `frontend/.env.production`:

```
REACT_APP_BACKEND_URL=https://your-actual-backend-url.onrender.com
REACT_APP_WS_URL=wss://your-actual-backend-url.onrender.com
```

### 2. Deploy to Vercel

1. **Connect Repository**:
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "New Project"
   - Import your GitHub repository

2. **Configure Project**:
   - **Framework Preset**: Create React App
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`

3. **Environment Variables**:
   - Add `REACT_APP_BACKEND_URL` with your Render backend URL
   - Add `REACT_APP_WS_URL` with your Render backend WebSocket URL

4. **Deploy**:
   - Click "Deploy"
   - Wait for deployment to complete
   - Your frontend will be available at a Vercel URL

## 🔄 CORS Configuration

Make sure your backend CORS settings allow your frontend domain. The backend is already configured with:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update this for production security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

For production, update `allow_origins` to include only your Vercel domain.

## 🧪 Testing Deployment

1. **Backend Health Check**:
   ```bash
   curl https://your-backend-url.onrender.com/health
   ```

2. **Frontend Access**:
   - Visit your Vercel URL
   - Test voice conversation functionality
   - Check browser console for any errors

## 🔧 Troubleshooting

### Common Issues:

1. **CORS Errors**:
   - Update backend CORS settings to include your frontend domain
   - Ensure environment variables are set correctly

2. **WebSocket Connection Failures**:
   - Verify WebSocket URL uses `wss://` for HTTPS sites
   - Check that Render service is running

3. **API Key Issues**:
   - Verify all environment variables are set in Render
   - Check that API keys are valid and have proper permissions

4. **Build Failures**:
   - Check build logs in Render/Vercel dashboards
   - Ensure all dependencies are listed in requirements.txt/package.json

## 📊 Monitoring

- **Render**: Monitor backend logs and performance in Render dashboard
- **Vercel**: Monitor frontend analytics and function logs in Vercel dashboard
- **Browser**: Use browser developer tools to debug client-side issues

## 🔒 Security Considerations

1. **Environment Variables**: Never commit API keys to version control
2. **CORS**: Restrict origins to your actual domains in production
3. **HTTPS**: Both services should use HTTPS/WSS in production
4. **Rate Limiting**: Consider implementing rate limiting for API endpoints

## 🚀 Performance Optimization

1. **Backend**: Consider upgrading to paid Render plan for better performance
2. **Frontend**: Vercel automatically optimizes static assets
3. **Caching**: The app includes response caching for better performance
4. **CDN**: Vercel provides global CDN for fast content delivery

## 📈 Scaling

- **Render**: Upgrade to paid plans for auto-scaling and better resources
- **Vercel**: Automatically scales based on traffic
- **Database**: Consider adding a database for persistent conversation history
- **Load Balancing**: For high traffic, consider multiple backend instances

Your Voice AI Conversational Agent is now ready for production! 🎉
