// 4.2 Сумма каждой строки, затем номер строки с максимальной суммой
#include <iostream>
using namespace std;

int main() {
    const int N = 3;
    int a[N][N];
    cout << "Введите матрицу " << N << "x" << N << ":" << endl;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            cin >> a[i][j];

    int maxSum = 0, maxRow = 0;
    for (int i = 0; i < N; i++) {
        int sum = 0;
        for (int j = 0; j < N; j++)
            sum += a[i][j];
        cout << "Сумма строки " << i + 1 << ": " << sum << endl;
        if (i == 0 || sum > maxSum) {
            maxSum = sum;
            maxRow = i;
        }
    }

    cout << "Строка с максимальной суммой: " << maxRow + 1 << endl;
    return 0;
}
