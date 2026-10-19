import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/db';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface PlanStats {
  name: string;
  count: number;
  color: string;
}

export default function SubscriptionPlanStats() {
  const [planStats, setPlanStats] = useState<PlanStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlanStats();
  }, []);

  const fetchPlanStats = async () => {
    try {
      setLoading(true);
      
      // Fetch all subscriptions with their plans
      const { data: subscriptions, error } = await supabase
        .from('pharmacy_subscriptions')
        .select(`
          id,
          subscription_plans (
            name
          )
        `);

      if (error) throw error;

      // Count by plan
      const planCounts: { [key: string]: number } = {
        'Basic': 0,
        'Advanced': 0,
        'Premium': 0,
        'Premium Plus': 0
      };

      subscriptions?.forEach((sub: any) => {
        const planName = sub.subscription_plans?.name;
        if (planName && planCounts.hasOwnProperty(planName)) {
          planCounts[planName]++;
        }
      });

      // Define distinct, colorful colors for each plan
      const colors: { [key: string]: string } = {
        'Basic': '#3b82f6',      // Bright Blue
        'Advanced': '#10b981',   // Emerald Green
        'Premium': '#f59e0b',    // Amber Orange
        'Premium Plus': '#8b5cf6' // Purple
      };

      const stats: PlanStats[] = Object.entries(planCounts).map(([name, count]) => ({
        name,
        count,
        color: colors[name]
      }));

      setPlanStats(stats);
    } catch (error) {
      console.error('Error fetching plan stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Subscription Plan Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center items-center h-64">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  const totalOwners = planStats.reduce((sum, stat) => sum + stat.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Subscription Plan Distribution
        </CardTitle>
        <CardDescription>
          Total business owners: {totalOwners}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {totalOwners === 0 ? (
          <div className="flex justify-center items-center h-64 text-muted-foreground">
            No subscription data available
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={planStats}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {planStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => [`${value} owner(s)`, 'Count']}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-4">
          {planStats.map((stat) => (
            <div key={stat.name} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: stat.color }}
              />
              <span className="text-sm">
                <span className="font-medium">{stat.name}:</span> {stat.count}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
