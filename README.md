# Hodhod backend (local development)

NestJS API with PostgreSQL. The teacher panel and student app are separate projects.

## Run locally

1. Start Docker Desktop in Linux-container mode. Install a current Node.js LTS release.
2. Copy `.env.example` to `.env` and set independent random `JWT_SECRET` and `AUTH_OTP_SECRET` values (at least 32 characters).
3. Run `npm install`.
4. Run `docker compose up -d` to start PostgreSQL. It is available on `127.0.0.1:55432` to avoid conflicts with other local projects.
5. Run `npm run migration:run` to create or upgrade the schema.
6. For local email, run `npm run mail:dev` in a separate terminal. The inbox is at `http://127.0.0.1:8025/`.
7. Run `npm run start:dev` to start the API at `http://127.0.0.1:3000`. In development the API binds only to this computer.

`GET /health` returns `{ "status": "ok" }`.

In development, Swagger UI is available separately at `/docs/student`, `/docs/teacher`, and `/docs/admin`; their OpenAPI JSON files are at `/docs/<audience>/openapi.json`. All three contain shared health, email authentication, logout and GET /me. Only the admin specification includes PATCH /admin/users/{id}/role; only the student specification includes PATCH /me. There is a `users` database table, but **no user-list API yet**. Swagger is not exposed when `NODE_ENV=production`. When adding an API, include its module in the relevant audience specification and document its request, response, authentication, and errors in the same change.

## Email sign-in (BE-03)

POST /auth/request-code with an email, then POST /auth/verify-code with that email and the six-digit code received through SMTP. Successful verification creates a revocable session. Codes expire, allow a limited number of guesses and cannot be reused. POST /auth/logout revokes the current session; POST /auth/logout-all revokes all account sessions.

The local SMTP setup, production settings, request limits and test instructions are in [the email authentication runbook](docs/EMAIL_AUTH.md). The fixed 11111 shortcut only works with NODE_ENV=development and AUTH_DEV_OTP_ENABLED=true. The example configuration uses real local SMTP instead.

Schema synchronization is disabled in every environment. Apply versioned migrations explicitly before starting the API. See [database model and migration runbook](docs/DATABASE.md). Run `npm run test:db` for isolated PostgreSQL integration checks. PostgreSQL data lives in a Docker named volume and survives normal `docker compose down`; do not use `docker compose down -v` unless you intend to delete it.


## Identity and roles (BE-02)

New accounts always have the student role. Supplying role or other unexpected
fields to authentication endpoints returns 400. GET /me uses the verified token
identity and returns id, email, role, displayName, avatarId, timezone and createdAt.
The login response now returns the same profile fields. Student profile editing is available through PATCH /me (BE-04).

All controller routes require a Bearer token by default; only health and OTP routes
are explicitly public. Tokens are checked against the account's current auth_version
and role on every request. Tokens issued before BE-03 must sign in again to establish a stored session.
Use @Roles('teacher') or @Roles('admin') for role-specific routes and reuse
ClassAccessService for class resources. An admin role is explicit; it does not
automatically satisfy a teacher-only endpoint.

PATCH /admin/users/:id/role accepts { "role": "teacher", "reason": "optional" }.
Only an authenticated admin may call it. The role, corresponding profile, version
increment and audit entry commit together. Existing profiles, progress and scores
remain. Old tokens immediately fail subsequent requests. Reapplying the same role
is a no-op. Concurrent role updates cannot demote the final administrator. A
demoted admin is rechecked inside the role-change transaction as well as the guard.

For a brand-new installation, register your chosen account normally, then run
npm run admin:bootstrap -- existing-account@example.com from a trusted terminal.
This operator-only command works only when no administrator exists, records a
bootstrap audit entry and invalidates that account's old tokens. It does not expose
a public bootstrap endpoint and never runs automatically. Sign in again afterwards.

BE-02 adds no class-content APIs; subsequent class
features must invoke the shared access check, with write ownership checked in the
same transaction as the write. Current read access permits a teacher's own classes,
an active student's current class, or explicit admin access.

Run npm run test:db for HTTP integration tests of default roles, token expiry/
revocation, forbidden elevation, audit atomicity, last-admin concurrency, class
boundaries and separate Swagger audiences in addition to migration checks.

## Student account settings (BE-04)

PATCH /me accepts only displayName, avatarId and timezone. It requires a student session and always updates the authenticated account. Display names are trimmed and limited to 1–120 characters. Avatar values are identifiers of up to 128 ASCII letters/digits/underscores/hyphens, not URLs; no product avatar catalog has been specified yet. Send null to clear the name or avatar. Omitted fields are unchanged.

Timezone must be a named timezone accepted by the runtime (for example Asia/Tehran), not a numeric offset. It is stored using the canonical runtime name. GET /me and subsequent logins return the saved settings. The API accepts no client timestamp, score, role, email or other account ID. Updating a timezone never rewrites historical attempts, point entries or daily-activity timezone snapshots. Streak qualification and future timezone-transition rules remain BE-19 product decisions.

## کلاس‌های معلم (BE-05)

تمام مسیرها نیازمند نشست معتبر با نقش teacher هستند و در Swagger معلم نمایش داده می‌شوند. مالک کلاس از نشست تعیین می‌شود.

| روش | مسیر | رفتار |
| --- | --- | --- |
| POST | /teacher/classes | ساخت کلاس با بدنهٔ {"name":"سوم الف"} و کد تصادفی یکتا |
| GET | /teacher/classes | فهرست کلاس‌های فعال و آرشیوشدهٔ خود معلم |
| GET | /teacher/classes/:id | جزئیات کلاس و کد فعال آن |
| POST | /teacher/classes/:id/join-code/rotate | تعویض کد؛ کد قبلی از رکورد حذف می‌شود |
| POST | /teacher/classes/:id/archive | آرشیو؛ تکرار درخواست زمان آرشیو را تغییر نمی‌دهد |

کلاس متعلق به معلم دیگر با 404 پاسخ داده می‌شود. کلاس آرشیوشده کد قابل نمایش ندارد و تعویض کد آن 409 می‌دهد. آرشیو سوابق و رکوردهای عضویت را حفظ می‌کند و دسترسی دانش‌آموز به کلاس غیرفعال می‌شود. API پیوستن، خروج و انتقال عضویت مربوط به BE-06 است. ایجاد و تعویض کد در برابر تداخل و درخواست هم‌زمان محافظت شده‌اند. migration جدید لازم نیست.

## کاتالوگ محتوا (BE-07)

فقط‌خواندنی است و migration جدید ندارد. محتوا را BE-09 (پنل مدیریت) می‌سازد؛ تا آن زمان ردیف‌ها با SQL/seed وارد می‌شوند. شناسهٔ پایدار همان `content_items.id` است و سوابق همیشه به آن وصل می‌مانند.

| روش | مسیر | نقش | رفتار |
| --- | --- | --- | --- |
| GET | /content | student | محتوای منتشرشده؛ فیلتر `kind` (adventure/practice؛ نوع `both` هر دو را می‌گیرد)، `subject`، `q`، `limit` (۱–۱۰۰، پیش‌فرض ۵۰)، `offset` |
| GET | /content/:id | student | یک محتوای منتشرشده |
| GET | /teacher/content | teacher | جست‌وجوی محتوای منتشرشدهٔ قابل‌تخصیص (فقط practice و both) |
| GET | /teacher/content/:id | teacher | پیش‌نمایش همان محتوا |

قاعدهٔ نمایش: `status='published'` و دست‌کم یک نسخه با `published_at` گذشته. `unityId` و `version` مربوط به آخرین نسخهٔ منتشرشده‌اند؛ پیش‌نویس، بایگانی‌شده، نسخهٔ منتشرنشده یا زمان‌بندی‌شدهٔ آینده هرگز برگردانده نمی‌شوند و با 404 پاسخ می‌گیرند. مدیر فعلاً مسیر خواندن کاتالوگ ندارد (BE-09).

## مسیر و قفل Adventure (BE-08)

| روش | مسیر | نقش | رفتار |
| --- | --- | --- | --- |
| GET | /adventure/map | student | مراحل منتشرشدهٔ Adventure به ترتیب `position`، همراه با وضعیت `locked`/`unlocked`، بهترین ستاره، تعداد تلاش، `passStars`/`maxStars` و `nextContentId` |

ترتیب و پیش‌نیاز در `adventure_stages` ذخیره است (migration جدید ندارد). مرحله باز است اگر پیش‌نیاز نداشته باشد، بهترین ستارهٔ دانش‌آموز در پیش‌نیاز به `unlockStars` (پیش‌فرض ۳) برسد، یا خود مرحله را قبلاً گذرانده باشد (تغییر بعدی قانون، پیشرفت کسب‌شده را قفل نمی‌کند). فقط `adventure_progress` همان دانش‌آموز حساب می‌شود؛ نتیجهٔ تکلیف معلم هیچ مرحله‌ای را باز نمی‌کند. `passStars`/`maxStars` از آخرین قانون اختصاصی محتوا، سپس قانون سراسری، و در نبود آن‌ها ۳ و ۵ است. مرحلهٔ پیش‌نویس، بایگانی، فقط‌تمرین یا بدون نسخهٔ منتشرشده نمایش داده نمی‌شود. بررسی قفل یک‌گامی است، پس زنجیرهٔ ناسالم حلقهٔ بی‌پایان نمی‌سازد؛ اعتبارسنجی حلقه/ترتیب هنگام نوشتن مسیر با BE-09 است، و پیش‌نیازِ مخفی‌شده تا پیش از اصلاح مدیر، مرحلهٔ بعدی را برای دانش‌آموزان تازه قفل نگه می‌دارد. مسیر جداگانهٔ `adventure/progress` لازم نشد چون نقشه همان داده را می‌دهد.

## مدیریت محتوا و قوانین (BE-09)

همهٔ مسیرها نیازمند نقش admin هستند و فقط در `/docs/admin` (و `/docs/admin/openapi.json`) ثبت شده‌اند. هر نوشتن، نقش و نسخهٔ نشست مدیر را زیر قفل دوباره بررسی می‌کند.

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET / POST | /admin/content | فهرست (فیلتر status, kind, subject, q) / ساخت پیش‌نویس با نسخهٔ ۱ و شناسهٔ Unity |
| GET / PATCH | /admin/content/:id | جزئیات با همهٔ نسخه‌ها / ویرایش title, subject, kind |
| POST | /admin/content/:id/versions | نسخهٔ منتشرنشدهٔ بعدی (شماره را سرور می‌دهد) |
| PATCH | /admin/content/:id/versions/:version | اصلاح نسخهٔ منتشرنشده |
| POST | /admin/content/:id/versions/:version/publish | انتشار با زمان سرور؛ تکرار زمان اول را نگه می‌دارد |
| POST | /admin/content/:id/unpublish، /archive | پنهان‌کردن (draft) یا بایگانی؛ چیزی حذف نمی‌شود |
| GET / PUT | /admin/adventure/path | مسیر کامل Adventure / جایگزینی ترتیب، پیش‌نیاز و unlockStars |
| GET / POST | /admin/rules | تاریخچهٔ قوانین (contentId یا scope=global) / نسخهٔ بعدی قانون |
| GET | /admin/rules/effective, /admin/rules/:id | قانون جاری (محتوا، سپس سراسری، سپس پیش‌فرض ۵ و ۳) / یک نسخه |

قواعد: شناسهٔ Unity بین محتواها یکتاست (409)؛ نسخهٔ منتشرشده تغییرناپذیر است و اصلاح آن نسخهٔ تازه می‌خواهد؛ نسخه‌ها به ترتیب منتشر می‌شوند و دانش‌آموز آخرین نسخهٔ منتشرشده را می‌بیند. در PUT مسیر، پیش‌نیاز باید زودتر از مرحله در فهرست بیاید (پس حلقه ممکن نیست)، محتوا باید adventure یا both باشد، و `unlockStars` از سقف ستارهٔ پیش‌نیاز بیشتر نباشد؛ حذف مرحله‌ای که دانش‌آموزی در آن پیشرفت دارد 409 است. قوانین فقط افزوده می‌شوند: نه PATCH داریم نه DELETE، و migration `ImmutableRuleHistory` در دیتابیس UPDATE/DELETE روی `scoring_rules` و `point_ledger` و تغییر نسخهٔ منتشرشده را رد می‌کند؛ پس تغییر قانون امتیاز ثبت‌شده را بازنویسی نمی‌کند. مقادیر جدول امتیاز (`definition`) هنوز تصمیم محصول است و seed نمی‌شود. ثبت سابقهٔ عامل تغییرات محتوا/قانون در BE-21 است.

## ساخت و زمان‌بندی تکلیف (BE-10)

فقط نقش teacher؛ در `/docs/teacher` ثبت شده است. migration جدید ندارد.

| روش | مسیر | رفتار |
| --- | --- | --- |
| POST | /teacher/assignments | ساخت تکلیف: `classId`, `contentId`, `audience` (`whole_class` یا `selected`), `studentIds` (فقط برای selected), `startsAt` (اختیاری، پیش‌فرض اکنون سرور), `endsAt` |
| GET | /teacher/assignments | فهرست تکلیف‌های خود معلم؛ فیلتر `classId`, `phase`, `limit`, `offset` |
| GET | /teacher/assignments/:id | جزئیات همراه با گیرندگان |
| POST | /teacher/assignments/:id/cancel | لغو تا پیش از پایان بازه؛ رکوردها می‌مانند و تکرار بی‌اثر است |

قواعد: کلاس باید مال همین معلم و فعال باشد (دیگری 404، آرشیو 409). محتوا باید منتشرشدهٔ نوع practice یا both با نسخهٔ منتشرشده باشد. زمان‌ها ISO 8601 با آفست (`Z` یا `+03:30`) هستند، `endsAt` باید در آینده و بعد از `startsAt` باشد و بازه حداکثر ۳۶۶ روز است؛ «اکنون» را ساعت دیتابیس تعیین می‌کند. `selected` فقط دانش‌آموزان عضو فعال همان کلاس را می‌پذیرد (تکراری یا غیرعضو 400). `whole_class` اعضای فعال لحظهٔ ساخت را در `assignment_recipients` ثبت می‌کند و کلاس بی‌دانش‌آموز 409 می‌دهد؛ گیرندگان بعداً تغییر نمی‌کنند و عضو تازه خودکار اضافه نمی‌شود (تصمیم باز شمارهٔ ۲ بخش ۷ طرح؛ با رکوردهای صریح هر دو سیاست ممکن می‌ماند). هر ساخت `id` تازه دارد، حتی برای همان محتوا و کلاس. گروه‌بندی وجود ندارد. `phase` از ساعت سرور محاسبه می‌شود: `upcoming`, `active`, `ended`, `cancelled`. ویرایش و تمدید بازه منتظر تصمیم باز شمارهٔ ۱ است و پیاده نشده؛ فهرست دانش‌آموز BE-12 و نتیجه/پیشرفت BE-11 و BE-14 هستند.

## نوبت‌های مستقل تکلیف (BE-11)

هر تخصیص (BE-10) یک `assignmentId` تازه است و پیشرفتش فقط با کلید `(assignment_id, student_id)` ذخیره می‌شود؛ پیشرفت Adventure در `adventure_progress` و دفتر امتیاز با `source`/`assignment_id` جداست. مسیر تازهٔ معلم:

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET | /teacher/assignments/:id/progress | برای هر گیرنده در همین نوبت: `status` (`not_started`/`in_progress`/`passed`)، `bestStars`، `attemptCount`، `points`، `firstPassedAt`، `lastAttemptAt` |

فقط ردیف‌های همان `assignmentId` خوانده می‌شوند، پس نتیجهٔ Adventure یا نوبت قبلیِ همان بازی نوبت تازه را تکمیل نمی‌کند و امتیازشان به آن اضافه نمی‌شود (با تست روی داده‌های واقعی attempt/ledger). دانش‌آموزی که کلاس را ترک کرده برای آن معلم نمایش داده نمی‌شود ولی سوابقش می‌ماند. `passed` از `first_passed_at` ثبت‌شده می‌آید، نه قانون امتیاز جاری. نوشتن این ردیف‌ها هنگام ثبت تلاش با BE-14/15/16 است. توجه: جزئیات تکلیف (`GET /teacher/assignments/:id`) هنوز کل گیرندگان زمان ساخت را نشان می‌دهد؛ محدودکردن آن به اعضای فعلی همراه گزارش‌های BE-13 انجام می‌شود.

## فهرست تکلیف‌های دانش‌آموز (BE-12)

فقط نقش student؛ در `/docs/student` ثبت شده است. migration جدید ندارد.

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET | /assignments/mine | تکلیف‌های خود دانش‌آموز؛ فیلتر `phase` (`upcoming`/`active`/`ended`)، `limit`، `offset` |
| GET | /assignments/mine/:id | یک نوبت از تکلیف‌های خودش |

ترتیب: بازها (مهلت نزدیک‌تر اول)، سپس آتی، سپس پایان‌یافته (تازه‌ترین اول). هر ردیف: `assignmentId` (شناسهٔ نوبت)، کلاس، محتوا (`contentId`, `title`, `subject`, `unityId`, `version`, `available`)، `startsAt`/`endsAt`، `phase` از ساعت سرور، و وضعیت همین نوبت (`status`: `not_started`/`in_progress`/`passed`، `bestStars`، `attemptCount`، `points`، `passStars`/`maxStars`). فقط ردیف‌های همین `assignmentId` خوانده می‌شود؛ Adventure و نوبت‌های دیگر همان بازی اثری ندارند. قواعد نمایش: دانش‌آموز باید گیرندهٔ صریح باشد و همان کلاس را اکنون عضو باشد (با ترک یا تغییر کلاس، تکلیف‌های کلاس قبلی از فهرست او خارج می‌شوند ولی سوابق می‌مانند؛ این تفسیر با تصمیم باز شمارهٔ ۶ هم‌جهت است و اگر محصول تاریخچهٔ کلاس قبلی را بخواهد باید تغییر کند)؛ تکلیف لغوشده پنهان است؛ عضو تازهٔ کلاس مخاطب تکلیف‌های قبلی نیست (تصمیم باز ۲). اگر محتوا بعداً از انتشار خارج شود، نوبت در فهرست می‌ماند با `available=false` و `unityId=null`. شروع تلاش روی نوبت فعال با BE-14 است.
