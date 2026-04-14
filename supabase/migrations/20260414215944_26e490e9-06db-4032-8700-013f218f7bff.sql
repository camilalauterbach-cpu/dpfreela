ALTER TABLE public.link_groups
  ADD CONSTRAINT link_groups_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  ADD CONSTRAINT link_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);