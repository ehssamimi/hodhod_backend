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

In development, Swagger UI is available separately at `/docs/student`, `/docs/teacher`, and `/docs/admin`; their OpenAPI JSON files are at `/docs/<audience>/openapi.json`. All three contain shared health, email authentication, logout and GET /me. Only the admin specification includes GET /admin/users and PATCH /admin/users/{id}/role; only the student specification includes PATCH /me. Swagger is not exposed when `NODE_ENV=production`. When adding an API, include its module in the relevant audience specification and document its request, response, authentication, and errors in the same change.

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

GET /admin/users lists accounts newest first for the management panel. It supports
role, case-insensitive email/display-name search, limit and offset; its paginated
response includes the total match count and never exposes session/token state.

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
| POST | /teacher/assignments/:id/extend | تمدید مهلت با `endsAt` تازه؛ تکلیف پایان‌یافته دوباره باز می‌شود، اما لغوشده/آرشیوشده نه |

قواعد: کلاس باید مال همین معلم و فعال باشد (دیگری 404، آرشیو 409). محتوا باید منتشرشدهٔ نوع practice یا both با نسخهٔ منتشرشده باشد. زمان‌ها ISO 8601 با آفست (`Z` یا `+03:30`) هستند، `endsAt` باید در آینده و بعد از `startsAt` باشد و بازه حداکثر ۳۶۶ روز است؛ «اکنون» را ساعت دیتابیس تعیین می‌کند. `selected` فقط دانش‌آموزان عضو فعال همان کلاس را می‌پذیرد و مخاطبانش ثابت‌اند. `whole_class` اعضای فعال را هنگام ساخت ثبت می‌کند و هر دانش‌آموزی که پیش از پایان مهلت بعداً به کلاس بپیوندد نیز خودکار گیرنده می‌شود. پس از پایان مهلت تلاش تازه بسته است؛ معلم می‌تواند فقط مهلت را به زمانی دیرتر و در آینده تمدید کند و تکلیف پایان‌یافته را دوباره باز کند. تکلیف لغوشده یا آرشیوشده قابل‌بازکردن نیست. هر ساخت `id` تازه دارد، گروه‌بندی وجود ندارد و `phase` از ساعت سرور محاسبه می‌شود: `upcoming`, `active`, `ended`, `cancelled`.

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

ترتیب: بازها (مهلت نزدیک‌تر اول)، سپس آتی، سپس پایان‌یافته (تازه‌ترین اول). هر ردیف: `assignmentId` (شناسهٔ نوبت)، کلاس، محتوا (`contentId`, `title`, `subject`, `unityId`, `version`, `available`)، `startsAt`/`endsAt`، `phase` از ساعت سرور، و وضعیت همین نوبت (`status`: `not_started`/`in_progress`/`passed`، `bestStars`، `attemptCount`، `points`، `passStars`/`maxStars`). فقط ردیف‌های همین `assignmentId` خوانده می‌شود؛ Adventure و نوبت‌های دیگر همان بازی اثری ندارند. دانش‌آموز باید گیرنده و عضو فعلی همان کلاس باشد؛ با ترک یا تغییر کلاس، تکلیف‌های کلاس قبلی از فهرست او خارج می‌شوند ولی سوابق می‌مانند. عضو تازه به تکلیف‌های `whole_class` که مهلتشان نگذشته اضافه می‌شود، ولی به تکلیف `selected` نه. تکلیف لغوشده پنهان است. اگر محتوا بعداً از انتشار خارج شود، نوبت با `available=false` و `unityId=null` می‌ماند.

## ثبت تلاش، پیشرفت و دفتر امتیاز (BE-14، BE-15، BE-16)

فقط نقش student؛ در `/docs/student`. migration `AttemptResultSnapshot` ستون `game_attempts.result` را برای بازپخش دقیق نتیجه اضافه می‌کند (`npm run migration:run`).

| روش | مسیر | رفتار |
| --- | --- | --- |
| POST | /attempts | ثبت نتیجهٔ پایان‌یافتهٔ یک تلاش آنلاین: `attemptId` (شناسهٔ یکتای ساختهٔ کلاینت)، `contentId`، `context` (`adventure`/`assignment`)، `assignmentId` (فقط برای تکلیف)، `stars`، `durationSeconds` |

**BE-14:** `attemptId` کلید یکتایی است. ثبت اول 201 می‌دهد؛ ارسال دوباره با همان شناسه و همان داده 200 با نتیجهٔ کاملاً یکسان و `duplicate=true` می‌دهد و چیزی نمی‌سازد؛ همان شناسه با داده‌ٔ متفاوت یا از دانش‌آموز دیگر 409 است. زمان دریافت را ساعت دیتابیس می‌گذارد و زمان شروع از `durationSeconds` به دست می‌آید. Adventure: محتوا باید روی نقشه و برای این دانش‌آموز باز باشد (قفل 403، خارج از نقشه 404). تکلیف: دانش‌آموز باید گیرندهٔ همان نوبت و عضو فعلی کلاس باشد، تکلیف لغو نشده و داخل بازه باشد و محتوا هنوز منتشر باشد؛ پس از پایان مهلت تلاش تازه 409 می‌گیرد تا معلم مهلت را تمدید کند. `stars` نباید از سقف قانون بیشتر باشد.

**BE-15:** پیشرفت هر زمینه جداست (`adventure_progress` یا `assignment_progress` همان `assignmentId`). `bestStars` فقط با نتیجهٔ بهتر بالا می‌رود، تعداد تلاش هر بار زیاد می‌شود و گذراندن با `passStars` قانون (پیش‌فرض ۳ از ۵) تعیین می‌شود؛ زمان اولین گذراندن ثابت می‌ماند.

**BE-16:** فقط بهبود بهترین ستاره امتیاز می‌دهد: مقدار = امتیاز قانون جاری برای بهترین ستارهٔ جدید منهای مجموع امتیازی که همان زمینه قبلاً گرفته؛ هرگز منفی نمی‌شود (قانون کم‌ارزش‌تر چیزی کم یا دوباره پرداخت نمی‌کند). ثبت تلاش، پیشرفت، امتیاز و نتیجهٔ ذخیره‌شده در یک تراکنش و زیر قفل هر دانش‌آموز انجام می‌شود تا درخواست هم‌زمان امتیاز تکراری نسازد. هر تلاش به همان نسخهٔ قانون (`scoringRuleId`) وصل است و دفتر امتیاز تغییرناپذیر است. **جدول امتیاز تصمیم محصول است و ساخته نشده:** امتیاز هر ستاره از `definition.starPoints` قانون (آرایه یا شیء) می‌آید، وگرنه از متغیر محیطی اختیاری `SCORING_STAR_POINTS` (مثلاً `0,0,0,20,30,40`) که فقط هنگام ساخت اولین قانون سراسری خوانده می‌شود؛ بدون هر دو، ستاره امتیازی نمی‌دهد. تست‌ها از یک جدول آزمایشی استفاده می‌کنند.

## بازخورد ۱ تا ۴ (BE-17)

| روش | مسیر | نقش | رفتار |
| --- | --- | --- | --- |
| POST | /feedback | student | ثبت `{contentId, rating}` با rating از ۱ تا ۴ برای بازی‌ای که دانش‌آموز حداقل یک تلاش در آن دارد |
| GET | /feedback/:contentId | student | نظر خود دانش‌آموز؛ اگر نداده باشد `rating=null` |
| GET | /teacher/feedback | teacher | نظر دانش‌آموزانی که همین الان در کلاس فعال همین معلم‌اند؛ فیلتر `contentId`, `classId` |
| GET | /admin/feedback | admin | همهٔ نظرها با خلاصهٔ تجمیعی (تعداد، میانگین، توزیع)؛ فیلتر `contentId` |

هر دانش‌آموز برای هر بازی یک نظر جاری دارد که بین Adventure و تکلیف مشترک است. اولین نظر می‌تواند در اپ اجباری باشد؛ پس از اجرای دوبارهٔ بازی، ثبت نظر اختیاری است و مقدار تازه جای مقدار قبلی را می‌گیرد. شرط «قبلاً بازی کرده باشد» جلوی نظر دادن به بازی اجرا‌نشده را می‌گیرد. نظر هیچ اثری بر امتیاز، پیشرفت یا رتبه‌بندی ندارد؛ معلم قبلی پس از ترک دانش‌آموز آن را نمی‌بیند.

## گزارش معلم (BE-13)

فقط نقش teacher؛ در `/docs/teacher`.

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET | /teacher/reports/assignments/:id | گزارش یک نوبت: برای هر دانش‌آموز `status`، `attemptCount`، `bestStars`، `passStars`، `points`، `firstAttemptAt`/`lastAttemptAt`، `firstPassedAt`، `totalDurationSeconds` و `feedbackRating` |
| GET | /teacher/reports/assignments/:id/students/:studentId | همهٔ تلاش‌های یک دانش‌آموز در آن نوبت با زمان دریافت، مدت و نسخهٔ محتوا |
| GET | /teacher/reports/students/:studentId | نوبت‌های همین معلم برای دانش‌آموزی که اکنون در یکی از کلاس‌های فعال اوست |

هر نوبت جدا گزارش می‌شود. دسترسی فقط برای تکلیف‌های خود معلم و دانش‌آموزانی است که همین الان عضو همان کلاس‌اند: با انتقال دانش‌آموز، معلم قبلی دسترسی آیندهٔ خود را از دست می‌دهد و معلم تازه تکلیف‌های کلاس قبلی را نمی‌بیند (تفسیر تصمیم باز شمارهٔ ۶؛ سوابق پاک نمی‌شوند). `GET /teacher/assignments/:id` هم از این پس فقط گیرندگانِ عضو فعلی را برمی‌گرداند و `recipientCount` اندازهٔ اولیهٔ مخاطبان است. ایمیل برنمی‌گردد.

## اعتبار نتیجه و محدودیت نرخ (BE-18)

جزئیات در [docs/ATTEMPT_VALIDITY.md](docs/ATTEMPT_VALIDITY.md). هویت، محتوا، دسترسی، بازه، ستاره و شناسهٔ تلاش پیش از ذخیره بررسی می‌شوند؛ هر درخواست ردشده بدون ذخیرهٔ تلاش، ردی ثابت در `suspicious_events` می‌گذارد (فقط مدیر: `GET /admin/suspicious-events` با فیلتر `studentId`، `reason`). تلاش پذیرفته‌شدهٔ گذرا که سریع‌تر از `ATTEMPT_MIN_PLAUSIBLE_SECONDS` (پیش‌فرض ۳) گزارش شود ذخیره و `implausible_duration` علامت می‌خورد. حداکثر `ATTEMPTS_PER_MINUTE` (پیش‌فرض ۳۰) ارسال در دقیقه برای هر حساب، 429 در غیر این صورت. **محدودیت:** سرور نمی‌تواند ثابت کند ستارهٔ ارسالی واقعاً از بازی‌کردن آمده؛ کلاینت دست‌کاری‌شدهٔ دارای نشست معتبر هر ستارهٔ مجاز را می‌فرستد و این فقط محدود و ردیابی می‌شود. این محدودیت باید پیش از انتشار عمومی رتبه‌بندی در نظر گرفته شود. migration جدید: `SuspiciousEvents`.

## روزهای فعالیت و استریک (BE-19)

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET | /streak | (student) `currentDays`، `bestDays`، `lastActivityDate`، `activeToday`، `timezone`، `today`، `recentDays` (۳۰ روز اخیر) |

هر تلاش ثبت‌شده در `POST /attempts` وضعیت استریک را برمی‌گرداند. Adventure فقط با نتیجهٔ گذرانده (پیش‌فرض حداقل ۳ ستاره) روز را فعال می‌کند؛ در تمرین معلم هر تلاش پایان‌یافته، حتی با صفر ستاره یا تمرین بدون مفهوم ستاره، روز استریک را حفظ می‌کند. Adventure و تکلیف یک روز مشترک می‌سازند و هر روز حداکثر یک بار ثبت و پاداش داده می‌شود. روز بر اساس منطقهٔ زمانی دانش‌آموز هنگام دریافت محاسبه و همان منطقه کنار روز ذخیره می‌شود. پاداش فقط در صورت تنظیم `STREAK_DAILY_POINTS` ثبت می‌شود.

## رتبه‌بندی (BE-20)

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET | /leaderboards/global | (student) پنج نفر اول کل سامانه و جایگاه خود دانش‌آموز |
| GET | /leaderboards/class | (student) پنج نفر اول کلاس فعلی و جایگاه خودش؛ بدون کلاس 404 |

پاسخ: `top` (تا پنج ردیف)، `me` و `participants`. ردیف‌ها فقط `rank`, `displayName`, `avatarId`, `points`, `isMe` دارند؛ ایمیل و شناسهٔ دیگران برنمی‌گردد. اگر دانش‌آموز در پنج نفر اول باشد فقط در `top` (با `isMe=true`) می‌آید و `me=null` است، وگرنه در `me`. امتیاز = مجموع کل دفتر امتیاز همان دانش‌آموز (ستاره‌ها، استریک، تعدیل) و به کلاس وابسته نیست؛ پس با تغییر کلاس می‌ماند و تابلوی کلاس فقط دانش‌آموزان فعلیِ همان کلاس را رتبه می‌دهد. **فرض‌های پیاده‌سازی برای تصمیم باز شمارهٔ ۵:** امتیاز برابر رتبهٔ برابر می‌گیرد (۱، ۲، ۲، ۴ …)؛ ترتیب داخل تساوی: کسی که زودتر به آن مجموع رسیده، سپس شناسه؛ نام نمایشی و آواتار همان مقادیر پروفایل‌اند (BE-04) و اگر خالی باشند `null` می‌آیند و اپ نمایش پیش‌فرض می‌دهد. **هشدار:** چون ستارهٔ ارسالی از Unity قابل اثبات نیست ([docs/ATTEMPT_VALIDITY.md](docs/ATTEMPT_VALIDITY.md))، پیش از انتشار عمومی رتبه‌بندی باید این ریسک در تصمیم انتشار لحاظ شود.

## گزارش کلی مدیر و سابقهٔ اقدامات (BE-21)

فقط نقش admin؛ در `/docs/admin`. migration جدید: `AdminAudit` (جدول `admin_audit`، فقط‌افزودنی با trigger دیتابیس).

| روش | مسیر | رفتار |
| --- | --- | --- |
| GET | /admin/overview | شمار کاربران به‌تفکیک نقش، کلاس‌ها، وضعیت انتشار محتوا، تکلیف‌ها به‌تفکیک فاز، تلاش‌ها (کل و ۷ روز اخیر)، رخدادهای مشکوک، و برای هر بازی: وضعیت انتشار، نسخهٔ جاری، تعداد تلاش و بازخورد تجمیعی (تعداد، میانگین، توزیع ۱ تا ۴) بدون هویت دانش‌آموز |
| GET | /admin/audit | سابقهٔ تغییرات حساس با عامل و زمان سرور؛ فیلتر `actorId`, `entityType`, `entityId`, `action`, `limit`, `offset` |

اقدام‌های ثبت‌شده در همان تراکنش تغییر: `content.create`, `content.update`, `content.version.add`, `content.version.update`, `content.publish`, `content.unpublish`, `content.archive`, `adventure.path.replace`, `rule.create` (هر کدام با جزئیات مانند نسخه، وضعیت قبلی، ستاره‌ها). درخواست تکراری بی‌تغییر و تغییر ناموفق سابقه نمی‌سازد؛ تغییر نقش کاربران در `role_change_audit` جداگانه ثبت می‌شود.

## سه صفحهٔ Swagger / OpenAPI (BE-24)

| صفحه | JSON |
| --- | --- |
| `/docs/student` | `/docs/student/openapi.json` |
| `/docs/teacher` | `/docs/teacher/openapi.json` |
| `/docs/admin` | `/docs/admin/openapi.json` |

هر endpoint فقط در صفحهٔ مصرف‌کنندهٔ خودش می‌آید؛ احراز هویت، `/me` و `/health` مشترک‌اند. فهرست ماژول‌های هر صفحه فقط در [src/swagger-modules.ts](src/swagger-modules.ts) است و هر ماژول جدید باید همان‌جا در صفحهٔ خودش ثبت شود. تست قرارداد (`npm run test:db`) روی API واقعی بررسی می‌کند که هر عملیات summary، برچسب، پاسخ موفق با schema، `security: bearer` و پاسخ 401 (و 403 برای معلم/مدیر، 400 برای مسیرهای پارامتردار) و مثال/توضیح برای فیلدهای بدنه دارد و هیچ مسیری در صفحهٔ اشتباه نیست. فایل‌های OpenAPI برای کلاینت‌ها در [docs/openapi/](docs/openapi/) نگهداری می‌شوند و با `npm run docs:export` از API واقعی بازتولید می‌شوند.

**دسترسی به مستندات:** در `NODE_ENV=development` باز است. در هر محیط دیگر پیش‌فرض خاموش است؛ برای روشن‌کردن باید `DOCS_ENABLED=true` و `DOCS_USER` و `DOCS_PASSWORD` (حداقل ۱۶ نویسه) تنظیم شود و صفحات پشت HTTP Basic می‌مانند؛ بدون اعتبارنامهٔ کافی صفحات روشن نمی‌شوند. مستندات جایگزین کنترل دسترسی نیست؛ نقش‌ها همچنان در خود API اعمال می‌شوند.

## قرارداد API و سناریوی یکپارچه (BE-22)

`npm run test:db` علاوه بر تست هر تسک، دو بررسی سراسری دارد: [scripts/api-contract-checks.cjs](scripts/api-contract-checks.cjs) قرارداد سه سند OpenAPI را با API واقعی می‌سنجد (BE-24)، و [scripts/scenario-checks.cjs](scripts/scenario-checks.cjs) فقط از راه API عمومی مسیر کامل را می‌رود: مدیر محتوا، قانون و مسیر Adventure را می‌سازد؛ دانش‌آموز مستقل بدون کلاس Adventure را بازی می‌کند و مرحلهٔ قفل را رد می‌شود؛ به کلاس می‌پیوندد؛ معلم یک بازی را دو بار تخصیص می‌دهد (دو نوبت مستقل)؛ ارسال تکراری هم‌زمان با یک شناسه یک تلاش و یک بار امتیاز می‌سازد؛ بهبودهای هم‌زمان در یک نوبت دقیقاً اختلاف را یک بار می‌پردازند؛ بازخورد و گزارش معلم؛ سپس انتقال به کلاس دیگر: امتیاز و پیشرفت شخصی می‌مانند، تکلیف‌های کلاس قبلی از فهرست دانش‌آموز می‌روند، معلم قبلی دسترسی آینده را از دست می‌دهد و معلم تازه نوبت تازهٔ مستقل می‌دهد؛ و در پایان ترک کلاس. نمونهٔ درخواست/پاسخ و خطاها در فایل‌های [docs/openapi/](docs/openapi/) و صفحه‌های Swagger هستند.

## آماده‌سازی انتشار (BE-23)

راهنمای کامل در [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). خلاصه: تنظیمات توسعه و تولید جداست و هر `NODE_ENV` جز `development` (حتی خالی) تولید حساب می‌شود؛ سرور با رمزهای کوتاه/یکسان، کد آزمایشی ورود، رمز محلی دیتابیس یا SMTP ناقص بالا نمی‌آید (فقط نام تنظیم چاپ می‌شود). `Dockerfile` و `compose.prod.yaml` API و PostgreSQL را بالا می‌آورند؛ **PostgreSQL هیچ پورتی منتشر نمی‌کند** و API فقط روی `127.0.0.1` برای reverse proxy است (با تست خودکار). `/health` (زنده‌بودن) و `/health/ready` (پاسخ‌گویی دیتابیس، ۵۰۳ در خرابی) برای پایش؛ هر درخواست یک خط JSON لاگ می‌شود بدون بدنه، توکن، ایمیل یا query. `scripts/db-backup.cjs` و `scripts/db-restore.cjs` پشتیبان‌گیری و بازیابی را انجام می‌دهند و `npm run test:db` هر بار آن را روی دیتابیس پرشده تمرین می‌کند (تعداد ردیف هر جدول، تاریخچهٔ migration، کلیدها و triggerها). ایمیج واقعی ساخته و با دیتابیس موقت آزموده شد: اجرای migration، `ready`، ۴۰۴ برای مستندات خاموش، ۴۰۱ بدون توکن و اجرا با کاربر غیر root. **باقی برای صاحب سرور:** TLS و reverse proxy، ارسال لاگ، زمان‌بندی و نگهداری پشتیبان خارج از میزبان.
