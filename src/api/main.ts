import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../infrastructure/database/prisma.js';
import { AuthenticationService } from '../modules/identity/application/authentication.js';
import { Argon2idPasswordHasher } from '../modules/identity/infrastructure/argon2-password-hasher.js';
import { JoseAccessTokenCodec } from '../modules/identity/infrastructure/access-tokens.js';
import { PrismaAuthSessionStore } from '../modules/identity/infrastructure/prisma-auth-session-store.js';
import { PrismaAuthenticationUserRepository } from '../modules/identity/infrastructure/prisma-authentication-users.js';
import { DefaultMembershipLifecycleService } from '../modules/identity/application/membership-lifecycle.service.js';
import { PrismaMembershipLifecycleTransactions } from '../modules/identity/infrastructure/prisma-membership-lifecycle.js';
import { PrismaMembershipChangeAuthorizer, PrismaOrganizationApplication, PrismaOrganizationMembershipResolver } from '../modules/identity/infrastructure/prisma-organizations.js';
import { RefreshSessionService } from '../modules/identity/infrastructure/refresh-sessions.js';
import { createApiApp } from './app.js';
import { loadApiConfiguration } from './config.js';
import { PrismaOrganizationInvitationStore } from '../modules/identity/infrastructure/prisma-organization-invitations.js';
import { OrganizationInvitationService } from '../modules/identity/application/invitations.js';
import { PrismaPasswordResetStore } from '../modules/identity/infrastructure/prisma-password-reset-store.js';
import { PasswordResetService } from '../modules/identity/application/password-reset.js';
import { SmtpIdentityDelivery } from '../modules/identity/infrastructure/smtp-identity-delivery.js';
import { DefaultProjectTaskService } from '../modules/projects/application/project-task.service.js';
import { PrismaProjectTaskStore } from '../modules/projects/infrastructure/prisma-project-task-store.js';

export async function startApi(): Promise<void> {
  const configuration = loadApiConfiguration();
  let app: ReturnType<typeof createApiApp> | undefined;
  try {
    const prisma = await connectDatabase();
    const sessions = new RefreshSessionService(
      new PrismaAuthSessionStore(prisma),
      new JoseAccessTokenCodec({
        secret: configuration.accessTokenSecret,
        issuer: configuration.tokenIssuer,
        audience: configuration.tokenAudience,
        lifetimeSeconds: configuration.accessTokenLifetimeSeconds,
      }),
    );
    const passwords = new Argon2idPasswordHasher();
    const authentication = await AuthenticationService.create(
      new PrismaAuthenticationUserRepository(prisma),
      passwords,
      sessions,
    );
    const membershipLifecycle = new DefaultMembershipLifecycleService(
      new PrismaMembershipLifecycleTransactions(prisma),
      new PrismaMembershipChangeAuthorizer(),
    );
    const mailDelivery = configuration.smtpUrl && configuration.smtpFrom && configuration.publicAppUrl
      ? SmtpIdentityDelivery.connect(configuration.smtpUrl, configuration.smtpFrom)
      : undefined;
    app = createApiApp({
      configuration,
      checkDatabaseReadiness: async () => { await prisma.$queryRaw`SELECT 1`; },
      authentication,
      sessions,
      organizations: new PrismaOrganizationApplication(prisma, membershipLifecycle),
      membershipResolver: new PrismaOrganizationMembershipResolver(prisma),
      projectTasks: new DefaultProjectTaskService(new PrismaProjectTaskStore(prisma)),
      ...(mailDelivery && configuration.publicAppUrl ? {
        invitations: new OrganizationInvitationService(
          new PrismaOrganizationInvitationStore(prisma), mailDelivery, configuration.publicAppUrl,
        ),
        passwordReset: new PasswordResetService(
          new PrismaPasswordResetStore(prisma), passwords, mailDelivery, configuration.publicAppUrl,
        ),
      } : {}),
    });
    await app.listen({ host: configuration.host, port: configuration.port });
  } catch (error) {
    await app?.close().catch(() => {});
    await disconnectDatabase().catch(() => {});
    throw error;
  }
  if (!app) throw new Error('API app initialization failed.');
  const runningApp = app;

  const shutdown = async (): Promise<void> => {
    await runningApp.close();
    await disconnectDatabase();
  };
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startApi().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown startup failure';
    const safeMessage = errorMessage
      .replace(/(?:postgres|postgresql):\/\/\S+/gi, '[REDACTED_DATABASE_URL]')
      .replace(/(password|secret|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');

    process.stderr.write(`FlowForge API startup failed [${errorName}]: ${safeMessage}\n`);
    process.exitCode = 1;
  });
}
