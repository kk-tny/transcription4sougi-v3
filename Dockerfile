# Use the official Node.js image.
FROM node:20-slim

# Set the working directory.
WORKDIR /app

# Copy package files and install dependencies.
COPY package*.json ./
RUN npm install

# Copy the rest of the application code.
COPY . .

# Build the frontend.
RUN npm run build

# Expose the port (Cloud Run sets PORT env var automatically).
EXPOSE 8080

# Command to run the application.
CMD ["npm", "start"]
