'use strict';

const axios = require('axios');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost';

const HEALTH_ENDPOINTS = [
  `${BASE_URL}/api/books/health`,
  `${BASE_URL}/api/loans/health`,
  `${BASE_URL}/api/users/health`,
  `${BASE_URL}/api/notifications/health`,
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServices = async (maxRetries = 30, delay = 2000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const checks = await Promise.all(
        HEALTH_ENDPOINTS.map((url) =>
          axios.get(url, { timeout: 3000 }).then(() => true).catch(() => false)
        )
      );

      const allHealthy = checks.every(Boolean);

      if (allHealthy) {
        console.log(`✅ All services healthy (attempt ${attempt}/${maxRetries})`);
        return;
      }

      const unhealthy = HEALTH_ENDPOINTS.filter((_, i) => !checks[i]);
      console.log(
        `⏳ Waiting for services... attempt ${attempt}/${maxRetries}. Unhealthy: ${unhealthy.join(', ')}`
      );
    } catch {
      console.log(`⏳ Waiting for services... attempt ${attempt}/${maxRetries}`);
    }

    if (attempt < maxRetries) {
      await sleep(delay);
    }
  }

  throw new Error(
    `Services did not become healthy after ${maxRetries} attempts (${(maxRetries * delay) / 1000}s timeout)`
  );
};

module.exports = { sleep, waitForServices, BASE_URL };
