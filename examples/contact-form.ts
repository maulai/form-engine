// Example: a contact form as an app would write it.
// - `form` comes from the app's kit (here the test kit: kinds only, no renderers yet)
import { z } from "zod";
import { form } from "../test/kit";

const contactSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["person", "company"]),
  company: z.object({ name: z.string(), vat_id: z.string() }),
  newsletter: z.boolean(),
  email: z.string(),
  addresses: z.array(z.object({ street: z.string(), city: z.string(), country: z.string(), state: z.string() })),
});

type StoredContact = z.infer<typeof contactSchema> & { id: string };

export const ContactForm = form(contactSchema, (f) => ({
  title: ({ edit }) => (edit ? "Edit contact" : "New contact"),
  defaults: (contact: StoredContact | undefined) => contact ?? { kind: "person" },
  sections: [
    {
      name: "General",
      fields: {
        name: f.text("Name").wide(),
        kind: f.select("Kind", ["person", "company"]).lockedOnEdit(),
        "company.name": f.text("Company").if("kind", "company"),
        "company.vat_id": f.text("VAT ID").if("kind", "company"),
        newsletter: f.switch("Newsletter"),
        email: f.text("E-mail").if("newsletter").hint("Only used for the newsletter."),
      },
    },
    {
      name: "Addresses",
      fields: {
        addresses: f.rows(
          (r) => ({
            street: r.text("Street"),
            city: r.text("City"),
            country: r.select("Country", ["DE", "AT", "CH"]),
            state: r.text("State").if("country", "DE"),
          }),
          { as: "cards", add: "Add address" },
        ),
      },
    },
  ],
}));

// Same form with typed props and context: the chain variant.
export const LockedKindContactForm = form(contactSchema)
  .props<{ kind?: "person" | "company" }>()
  .context(() => ({ countries: ["DE", "AT"] as const }))
  .define((f) => ({
    defaults: (_contact, { props }) => ({ kind: props.kind ?? "person" }),
    sections: [
      {
        fields: {
          kind: f.select("Kind", ["person", "company"]).fixed(({ props }) => props.kind),
          name: f.text("Name").onChange((name, { set }) => set("company.name", name)),
        },
      },
    ],
  }));
