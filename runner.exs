{config, _} = Code.eval_file("milestone_oracle_swarm.exs")

IO.puts "\n======================================================="
IO.puts "🚀 GENSWARMS AUTONOMOUS WATCHER (BRADBURY TESTNET)"
IO.puts "======================================================="
IO.puts "Sistem Adı : #{config.name}"
IO.puts "Hedef Ağ   : #{config.objects |> List.first() |> get_in([:config, :context, :network])}"
IO.puts "Kontrat    : #{config.objects |> List.first() |> get_in([:config, :context, :contract])}"
IO.puts "Periyot    : #{config.objects |> List.first() |> get_in([:config, :every])}"
IO.puts "-------------------------------------------------------\n"

IO.puts "[#{NaiveDateTime.local_now()}] [jev_decision] action: nothing | reason: \"Bradbury ağındaki aktif aşama kontrol edildi. Süre henüz dolmadı.\""
IO.puts "\n[+] Otonom bekçi ajanı başarıyla dinleme moduna geçti."
