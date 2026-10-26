#!/usr/bin/env node
/**
 * Standalone SMTP Connectivity & Authentication Diagnostic Tool
 * Run this directly in the Render shell or terminal to test outbound connectivity:
 *   node src/utils/testSmtpConnection.js
 *
 * Checks:
 * 1. Environment variable resolution and aliases
 * 2. DNS resolution for the SMTP host
 * 3. TCP socket connection and TLS handshake (port 465 implicit TLS or port 587 STARTTLS)
 * 4. Google SMTP authentication with provided App Password
 *
 * Strictly NEVER prints credentials, app passwords, or sensitive tokens.
 */

import { config } from '../config/env.js';
import { getTransporterOptions, verifySmtpConnection, maskEmail } from '../services/mailService.js';

async function runDiagnostic() {
  console.log('\n🔍 ========================================================');
  console.log('   CAMPUS BOOK EXCHANGE — SMTP CONNECTIVITY DIAGNOSTIC    ');
  console.log('========================================================\n');

  const options = getTransporterOptions();
  const maskedUser = config.smtp.user ? maskEmail(config.smtp.user) : 'NOT_SET';
  const hasAppPassword = Boolean(config.smtp.appPassword);
  const passwordLength = config.smtp.appPassword ? config.smtp.appPassword.length : 0;

  console.log('📋 Resolved Configuration:');
  console.log(`   • Host:            ${options.host}`);
  console.log(`   • Port:            ${options.port}`);
  console.log(`   • Implicit TLS:    ${options.secure} (Port 465=true, Port 587=false)`);
  console.log(`   • Require STARTTLS:${options.requireTLS} (Mandatory on port 587)`);
  console.log(`   • Address Family:  IPv${options.family} (Forced IPv4 avoids container IPv6 blackholes)`);
  console.log(`   • Timeout:         Connect: ${options.connectionTimeout}ms | Socket: ${options.socketTimeout}ms`);
  console.log(`   • User Account:    ${maskedUser}`);
  console.log(`   • Password Set:    ${hasAppPassword ? `YES (${passwordLength} characters)` : 'NO (MISSING)'}`);
  console.log(`   • Min TLS Version: ${options.tls.minVersion}`);

  if (!config.smtp.user || !config.smtp.appPassword) {
    console.error('\n❌ CONFIGURATION ERROR:');
    console.error('   EMAIL_USER and EMAIL_APP_PASSWORD are not configured in environment.');
    console.error('   Please configure these in your Render Dashboard -> Environment variables.');
    process.exit(1);
  }

  console.log('\n⏳ Initiating connection test to ' + options.host + ':' + options.port + '...');
  const startTime = Date.now();

  try {
    const result = await verifySmtpConnection();
    const duration = Date.now() - startTime;

    if (result.success) {
      console.log(`\n✅ SUCCESS (Completed in ${duration}ms):`);
      console.log('   • TCP connection established.');
      console.log('   • TLS encrypted session verified.');
      console.log('   • SMTP credentials and Google App Password accepted.');
      console.log('   • Ready to dispatch OTP verification and password reset emails!\n');
      process.exit(0);
    } else {
      console.error(`\n❌ VERIFICATION FAILED (after ${duration}ms):`);
      console.error(`   • Failure Stage: ${result.failureStage}`);
      console.error(`   • Error Code:    ${result.errorCode || 'N/A'}`);
      console.error(`   • Details:       ${result.details}`);

      if (result.failureStage === 'TCP_CONNECTION') {
        console.error('\n💡 DIAGNOSTIC GUIDANCE FOR TCP CONNECTION TIMEOUT:');
        console.error('   The TCP connection could not be opened to ' + options.host + ':' + options.port + '.');
        if (options.port === 465) {
          console.error('   Try switching to port 587 in Render environment variables:');
          console.error('     SMTP_PORT=587');
          console.error('     SMTP_SECURE=false');
        } else {
          console.error('   Try switching to port 465 in Render environment variables:');
          console.error('     SMTP_PORT=465');
          console.error('     SMTP_SECURE=true');
        }
        console.error('   If both 465 and 587 time out, Render is blocking outbound SMTP connections.');
      } else if (result.failureStage === 'SMTP_AUTHENTICATION') {
        console.error('\n💡 DIAGNOSTIC GUIDANCE FOR AUTHENTICATION FAILURE:');
        console.error('   TCP connection succeeded, but Google rejected the credentials (HTTP 535).');
        console.error('   Verify 2-Step Verification is ON and generate a fresh 16-character App Password.');
      }
      process.exit(1);
    }
  } catch (unexpectedError) {
    console.error('\n❌ UNEXPECTED ERROR DURING TEST:', unexpectedError.message);
    process.exit(1);
  }
}

runDiagnostic();
