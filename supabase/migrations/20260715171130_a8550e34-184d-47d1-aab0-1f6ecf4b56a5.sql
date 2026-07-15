
ALTER TABLE public.change_logs DROP CONSTRAINT IF EXISTS change_logs_action_check;
ALTER TABLE public.change_logs ADD CONSTRAINT change_logs_action_check
  CHECK (action = ANY (ARRAY[
    'insert','update','delete',
    'merge_workers_success','merge_conflict','merge_payroll_item_consolidated',
    'invite_accepted'
  ]));
