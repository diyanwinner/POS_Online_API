# POS Online API (Express + Neon)

## Environment
Create `.env` with:
```
DATABASE_URL=postgres://POS_DB:<password>@<neon-pooled-host>/<neondb>?sslmode=require
```

## Run locally
```
npm install
npm start
```

## Deploy on Render
- New → Web Service → connect this repo
- Start Command: `node server.js`
- Add Env Var: `DATABASE_URL`
- After deploy, check `/health`
