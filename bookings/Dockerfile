FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=4173
ENV BOOKINGS_DATA_FILE=/data/data.json

WORKDIR /app
COPY bookings ./bookings
COPY index.html index.css style.css ./
COPY images ./images

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 4173
CMD ["node", "bookings/server.js"]