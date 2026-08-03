create table userIdMigration (
  oldId text primary key,
  newId text not null unique,
  email text not null
);

insert into userIdMigration (oldId, newId, email)
select id,
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  email
from "user";

insert into account (id, accountId, providerId, userId, createdAt, updatedAt)
select
  lower(hex(randomblob(16))),
  m.oldId,
  'seatable',
  m.oldId,
  u.createdAt,
  u.updatedAt
from userIdMigration m
join "user" u on u.id = m.oldId
where lower(m.email) = lower(m.oldId || '@smail.nju.edu.cn')
  and not exists (
    select 1 from account a where a.providerId = 'seatable' and a.accountId = m.oldId
  );

insert into account (id, accountId, providerId, userId, createdAt, updatedAt)
select
  lower(hex(randomblob(16))),
  lower(m.email),
  'email',
  m.oldId,
  u.createdAt,
  u.updatedAt
from userIdMigration m
join "user" u on u.id = m.oldId
where u.emailVerified = 1
  and not exists (
    select 1 from account a where a.providerId = 'email' and a.accountId = lower(m.email)
  );

update "user"
set email = '__migrating__' || lower(hex(randomblob(12))) || '@invalid'
where id in (select oldId from userIdMigration);

insert into "user" (id, name, email, emailVerified, image, createdAt, updatedAt, onboardingCompleted)
select
  m.newId,
  u.name,
  m.email,
  u.emailVerified,
  u.image,
  u.createdAt,
  u.updatedAt,
  u.onboardingCompleted
from userIdMigration m
join "user" u on u.id = m.oldId;

update session set userId = (select newId from userIdMigration where oldId = session.userId)
where userId in (select oldId from userIdMigration);
update account set userId = (select newId from userIdMigration where oldId = account.userId)
where userId in (select oldId from userIdMigration);
update oauthClient set userId = (select newId from userIdMigration where oldId = oauthClient.userId)
where userId in (select oldId from userIdMigration);
update oauthClient set pinnedUserId = (select newId from userIdMigration where oldId = oauthClient.pinnedUserId)
where pinnedUserId in (select oldId from userIdMigration);
update oauthRefreshToken set userId = (select newId from userIdMigration where oldId = oauthRefreshToken.userId)
where userId in (select oldId from userIdMigration);
update oauthAccessToken set userId = (select newId from userIdMigration where oldId = oauthAccessToken.userId)
where userId in (select oldId from userIdMigration);
update oauthConsent set userId = (select newId from userIdMigration where oldId = oauthConsent.userId)
where userId in (select oldId from userIdMigration);

delete from "user" where id in (select oldId from userIdMigration);
drop table userIdMigration;

delete from account
where rowid not in (
  select min(rowid) from account group by providerId, accountId
);

create unique index account_provider_account_idx on account (providerId, accountId);
