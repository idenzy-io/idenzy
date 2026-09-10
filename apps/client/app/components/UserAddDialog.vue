<script setup lang="ts">
/**
 * The form that creates a user by hand. What the management API's create call takes, and
 * no more: an identifier, which is an email or a phone and either will do, a name, and a
 * password if the account is to sign in with one.
 *
 * What it will not do is promise a way in the project does not have. Without a password an
 * account signs in by a code, and a code needs the channel switched on: email codes off, or
 * SMS codes with no country allowed, and the account is created with no way in at all. So
 * the line under the fields is worked out from the project's own settings, names the screen
 * that fixes it, and the form still creates the account, because "no way in yet" is a real
 * state and refusing to record a person is not the panel's decision to make.
 *
 * The password rule is the project's, read off the password policy rather than written here:
 * a form that accepted eight characters where the project asks for twelve is a failure the
 * operator only meets at the server.
 *
 * Closing is what a settled call does, never what a click does. A refusal keeps the draft,
 * says what happened beside the action, and lets it be sent again.
 */
import type { AddUserInput } from "~/stores/users";
import { LENGTH_CEILING } from "~/utils/password-policy";
import { newAccountOutcome, type ProjectSignInSettings, signInPaths } from "~/utils/sign-in-paths";
import { canSendSms } from "~/utils/sms-policy";

const props = defineProps<{
  /** Performs the write. It rejects on a refusal, and the dialog stays open on one. */
  create: (input: AddUserInput) => Promise<unknown>;
}>();

const open = defineModel<boolean>({ required: true });

const projects = useProjectStore();
const policies = usePasswordPolicyStore();
const otp = useOtpStore();
const smsPolicy = useSmsPolicyStore();

const email = ref("");
const phone = ref("");
const displayName = ref("");
const password = ref("");
const emailVerified = ref(false);
const revealed = ref(false);
const touched = ref(false);
const busy = ref(false);
const failure = ref("");

watch(open, (value) => {
  if (!value) return;
  email.value = "";
  phone.value = "";
  displayName.value = "";
  password.value = "";
  emailVerified.value = false;
  revealed.value = false;
  touched.value = false;
  failure.value = "";
});

const policy = computed(() => policies.policyFor(projects.current.id));

/* The three paths an operator can hand out, as the project has them today. */
const settings = computed<ProjectSignInSettings>(() => {
  const codes = otp.settingsFor(projects.current.id);
  return {
    passwordEnabled: policy.value.enabled,
    emailCodeEnabled: codes.email.enabled,
    smsCodeEnabled: codes.sms.enabled,
    smsPolicyReady: canSendSms(smsPolicy.policyFor(projects.current.id)),
  };
});

const paths = computed(() => signInPaths(settings.value));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

const cleanEmail = computed(() => email.value.trim().toLowerCase());
const cleanPhone = computed(() => phone.value.replace(/[\s()-]/g, ""));

const errors = computed(() => {
  const list: Partial<Record<"identifier" | "email" | "phone" | "password", string>> = {};
  if (cleanEmail.value === "" && cleanPhone.value === "") {
    list.identifier = "An email address or a phone number is needed.";
  }
  if (cleanEmail.value !== "" && !EMAIL.test(cleanEmail.value)) {
    list.email = "That does not look like an email address.";
  }
  if (cleanPhone.value !== "" && !E164.test(cleanPhone.value)) {
    list.phone = "Use the international form: +14155550123.";
  }
  if (password.value !== "" && password.value.length < policy.value.minLength) {
    list.password = `This project asks for at least ${policy.value.minLength} characters.`;
  }
  if (password.value.length > LENGTH_CEILING) {
    list.password = `At most ${LENGTH_CEILING} characters.`;
  }
  return list;
});

const valid = computed(() => Object.keys(errors.value).length === 0);

/* Shown only once the form has been sent, so a blank form does not open covered in red. */
const shown = computed(() => (touched.value ? errors.value : {}));

/** How this account will sign in, or why it will not be able to. */
const outcome = computed(() =>
  newAccountOutcome(
    {
      email: cleanEmail.value === "" ? null : cleanEmail.value,
      phone: cleanPhone.value === "" ? null : cleanPhone.value,
      password: password.value !== "",
    },
    paths.value,
  ),
);

/* Verification is not sent on creation by anybody: the API creates the row and nothing
   leaves. Said out loud, because "add user" reads as "invite user" on every other panel. */
const verification = computed(() => {
  if (cleanEmail.value === "") return "";
  return emailVerified.value
    ? "Marked verified, so nothing is sent and other sign-ins may link on this address."
    : "No message is sent now. The address is verified by their first code, or by a link you send.";
});

async function submit() {
  touched.value = true;
  failure.value = "";
  if (!valid.value || busy.value) return;
  busy.value = true;
  try {
    await props.create({
      email: cleanEmail.value === "" ? null : cleanEmail.value,
      phone: cleanPhone.value === "" ? null : cleanPhone.value,
      displayName: displayName.value.trim() === "" ? null : displayName.value.trim(),
      password: password.value === "" ? null : password.value,
      emailVerified: cleanEmail.value !== "" && emailVerified.value,
    });
    open.value = false;
  } catch (error) {
    failure.value =
      error instanceof Error && error.message !== ""
        ? error.message
        : "The account could not be created. Nothing was saved, so this can be sent again.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="440">
    <v-card border flat>
      <form class="flex flex-col p-6" novalidate @submit.prevent="submit">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Add a user</h2>
          <p class="m-0 text-xs text-ink/60">
            Creates the account on
            <span class="font-medium text-ink/80">{{ projects.current.name }}</span
            >. An email address or a phone number is enough; either one identifies them.
          </p>
        </header>

        <div class="mt-6 flex flex-col gap-2">
          <label class="text-xs font-medium opacity-70" for="add-user-email">Email address</label>
          <v-text-field
            id="add-user-email"
            v-model="email"
            :disabled="busy"
            :error="!!shown.email || !!shown.identifier"
            autocomplete="off"
            autofocus
            hide-details
            name="email"
            placeholder="name@example.com"
            type="email"
            variant="filled"
          />
          <p v-if="shown.email" class="m-0 text-[11px] text-error">{{ shown.email }}</p>

          <label class="mt-4 text-xs font-medium opacity-70" for="add-user-phone">
            Phone number <span class="font-normal opacity-70">· or this instead</span>
          </label>
          <v-text-field
            id="add-user-phone"
            v-model="phone"
            :disabled="busy"
            :error="!!shown.phone || !!shown.identifier"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="phone"
            placeholder="+14155550123"
            type="tel"
            variant="filled"
          />
          <p v-if="shown.phone" class="m-0 text-[11px] text-error">{{ shown.phone }}</p>
          <p v-else-if="shown.identifier" class="m-0 text-[11px] text-error">
            {{ shown.identifier }}
          </p>

          <label class="mt-4 text-xs font-medium opacity-70" for="add-user-name">
            Display name <span class="font-normal opacity-70">· optional</span>
          </label>
          <v-text-field
            id="add-user-name"
            v-model="displayName"
            :disabled="busy"
            autocomplete="off"
            hide-details
            name="displayName"
            placeholder="Nuray Aksoy"
            variant="filled"
          />

          <label class="mt-4 text-xs font-medium opacity-70" for="add-user-password">
            Password <span class="font-normal opacity-70">· optional</span>
          </label>
          <v-text-field
            id="add-user-password"
            v-model="password"
            :append-inner-icon="revealed ? 'lucide:eye-off' : 'lucide:eye'"
            :disabled="busy"
            :error="!!shown.password"
            :type="revealed ? 'text' : 'password'"
            autocomplete="new-password"
            hide-details
            name="password"
            placeholder="Leave empty for a passwordless account"
            variant="filled"
            @click:append-inner="revealed = !revealed"
          />
          <p v-if="shown.password" class="m-0 text-[11px] text-error">{{ shown.password }}</p>
          <p v-else class="m-0 text-[11px] text-ink/50">
            At least
            <span class="font-mono tabular-nums">{{ policy.minLength }}</span>
            characters, this project's rule. Hashed with Argon2id on the server.
          </p>

          <label class="mt-5 flex cursor-pointer items-start gap-2 text-xs text-ink">
            <v-checkbox-btn
              v-model="emailVerified"
              :disabled="busy || cleanEmail === ''"
              class="-mt-1.5 -ml-1.5"
              color="primary"
              density="compact"
            />
            <span class="flex flex-col gap-0.5 pt-px">
              Mark the email as verified
              <span class="text-[11px] text-ink/50">
                Only if you have checked the address yourself: a verified address is what
                other sign-ins can be linked on.
              </span>
            </span>
          </label>
        </div>

        <!-- What the account gets, in the project's terms rather than the form's. A path
             that is off names the screen that turns it on, because the operator reading
             this is the person who can. -->
        <div class="mt-5 flex flex-col gap-1 rounded-(--idenzy-radius) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
          <span class="flex items-center gap-1.5 text-[11px] font-medium text-ink/70">
            <Icon
              :class="outcome.ok ? 'text-success' : 'text-warning'"
              :name="
                outcome.ok
                  ? 'material-symbols:check-circle-outline'
                  : 'material-symbols:warning-outline'
              "
              aria-hidden="true"
              class="text-[13px]"
            />
            How they sign in
          </span>
          <p class="m-0 text-[11px] leading-4 text-ink/70">
            {{ outcome.text }}
            <NuxtLink
              v-if="outcome.fix"
              :to="outcome.fix.to"
              class="text-ink/70 underline underline-offset-2 transition-colors hover:text-ink"
            >
              {{ outcome.fix.label }}
            </NuxtLink>
          </p>
          <p v-if="verification" class="m-0 text-[11px] leading-4 text-ink/45">
            {{ verification }}
          </p>
        </div>

        <p v-if="failure" class="mt-4 mb-0 text-[11px] leading-4 text-error" role="alert">
          {{ failure }}
        </p>

        <footer class="mt-6 flex items-center justify-end gap-2">
          <v-btn
            :disabled="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <FancyButton :disabled="busy || (touched && !valid)" type="submit">
            <Icon
              v-if="busy"
              aria-hidden="true"
              class="animate-spin text-sm"
              name="material-symbols:progress-activity"
            />
            <Icon
              v-else
              aria-hidden="true"
              class="text-sm"
              name="material-symbols:person-add-outline"
            />
            {{ busy ? "Creating…" : "Create account" }}
          </FancyButton>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
