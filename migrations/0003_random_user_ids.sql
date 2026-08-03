pragma foreign_keys = off;

create temporary table userIdMigration (
  oldId text primary key,
  newId text not null unique
);

insert into userIdMigration (oldId, newId)
select id,
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
from "user";

insert into account (id, accountId, providerId, userId, createdAt, updatedAt)
select
  lower(hex(randomblob(16))),
  u.id,
  'seatable',
  u.id,
  u.createdAt,
  u.updatedAt
from "user" u
where lower(u.email) = lower(u.id || '@smail.nju.edu.cn')
  and not exists (
    select 1 from account a where a.providerId = 'seatable' and a.accountId = u.id
  );

insert into account (id, accountId, providerId, userId, createdAt, updatedAt)
select
  lower(hex(randomblob(16))),
  lower(u.email),
  'email',
  u.id,
  u.createdAt,
  u.updatedAt
from "user" u
where u.emailVerified = 1
  and not exists (
    select 1 from account a where a.providerId = 'email' and a.accountId = lower(u.email)
  );

update session set userId = (select newId from userIdMigration where oldId = session.userId);
update account set userId = (select newId from userIdMigration where oldId = account.userId);
update oauthClient set userId = (select newId from userIdMigration where oldId = oauthClient.userId)
where userId is not null;
update oauthClient set pinnedUserId = (select newId from userIdMigration where oldId = oauthClient.pinnedUserId)
where pinnedUserId is not null;
update oauthRefreshToken set userId = (select newId from userIdMigration where oldId = oauthRefreshToken.userId);
update oauthAccessToken set userId = (select newId from userIdMigration where oldId = oauthAccessToken.userId)
where userId is not null;
update oauthConsent set userId = (select newId from userIdMigration where oldId = oauthConsent.userId)
where userId is not null;
update "user" set id = (select newId from userIdMigration where oldId = "user".id);

drop table userIdMigration;

delete from account
where rowid not in (
  select min(rowid) from account group by providerId, accountId
);

create unique index account_provider_account_idx on account (providerId, accountId);

pragma foreign_keys = on;
