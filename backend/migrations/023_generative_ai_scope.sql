-- Uretken yapay zeka ozellikleri (spec/79 §9): malzeme onerisi, mail taslagi.
-- Kapsami olmayana pasif oneri bile gosterilmez; LLM yuku uclari da bunu arar.
insert into scopes (name) values ('use_generative_ai') on conflict (name) do nothing;
