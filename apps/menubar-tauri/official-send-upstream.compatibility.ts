import type { SendFormGenerationService } from "../../vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/abstractions/send-form-generation.service";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Condition extends true> = Condition;

export type OfficialSendGenerationContract = Assert<
  Equal<SendFormGenerationService["generatePassword"], () => Promise<string | null>>
>;
