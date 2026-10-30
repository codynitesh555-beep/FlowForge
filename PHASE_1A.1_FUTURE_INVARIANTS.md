# Phase 1A.1 — Future Application Invariants

These rules are mandatory for the future Identity, Assignment, Activity, and
Outbox application modules. They are **not implemented or enforced by the
Phase 1A schema alone**.

- Task assignment requires the referenced membership to be `ACTIVE` at the
  time of assignment.
- Every organization must retain at least one `ACTIVE` `OWNER`; a transition
  that would deactivate or remove the last active owner must fail atomically.
- Membership lifecycle transactions acquire the owning `Organization` row
  with `SELECT ... FOR UPDATE` first. This row is the serialization key for
  owner-role/status/removal changes in that organization. Recount active owners
  and validate the proposed transition only after acquiring this lock, then
  persist the transition before commit. All code paths that mutate membership
  lifecycle state must follow this order.
- After the organization lock, acquire affected `Membership` rows in ascending
  `Membership.id` UUID order. For assignment creation, acquire the owning
  `Membership` row `FOR UPDATE` before reading its status and inserting the
  assignment. Assignment creation need not acquire the organization lock; it
  must never acquire locks in the reverse order. This serializes assignment
  creation against membership deactivation without introducing a lock cycle.
- Membership deactivation coordinates assignment release in the same
  transaction: organization row, affected membership rows in ascending UUID
  order, membership transitions, then affected assignment rows in ascending
  assignment ID order through one batch operation. Any failure aborts the
  whole transaction. Use the same lock order for every bulk membership path.
- The organization row lock intentionally serializes membership lifecycle
  mutations within one organization. If that contention later becomes
  material, any replacement must preserve last-active-owner serialization and
  prove an equivalent deadlock-free lock order before adoption.
- An ActivityLog actor must be authorized in the organization whose activity
  record is being written. The direct global User foreign key does not prove
  organization membership.
- Outbox aggregate ownership must be checked in application logic because
  `aggregateId` is intentionally polymorphic.
