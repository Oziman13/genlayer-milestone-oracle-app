%{
  name: "milestone-oracle",
  agents: [
    %{
      name: :oracle_validator,
      backend: :local, 
      skills: ["oracle_validation.md"],
      model: "anthropic/claude-sonnet-4"
    }
  ],
  objects: [
    %{
      name: :milestone_watcher,
      handler: Genswarms.Objects.JevCron,
      config: %{
        every: "10m",
        instructions: "MilestoneOracle kontratındaki aktif aşamanın 'window_end' (bitiş) süresini kontrol et.",
        context: %{contract: "MilestoneOracle", network: "bradbury"},
        actions: [
          %{
            id: "nothing",
            when: "Süre henüz dolmadı veya süreç normal ilerliyor."
          },
          %{
            id: "finalize",
            when: "Aşamanın süresi doldu ve challenge window kapandı.",
            send: %{to: :oracle_validator, text: "Süre doldu! Kontrattaki finalizeMilestone() fonksiyonunu otonom olarak tetikle."}
          }
        ],
        fallback: "nothing"
      }
    }
  ],
  topology: [
    {:milestone_watcher, :oracle_validator},
    {:oracle_validator, :milestone_watcher}
  ]
}
