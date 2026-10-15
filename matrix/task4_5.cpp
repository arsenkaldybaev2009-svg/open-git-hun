// 4.5 Количество отрицательных, максимальный элемент и его позиция
#include <iostream>
using namespace std;

int main() {
    const int N = 3;
    int a[N][N];
    cout << "Введите матрицу " << N << "x" << N << ":" << endl;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            cin >> a[i][j];

    int negCount = 0;
    int maxVal = a[0][0], maxRow = 0, maxCol = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            if (a[i][j] < 0) negCount++;
            if (a[i][j] > maxVal) {
                maxVal = a[i][j];
                maxRow = i;
                maxCol = j;
            }
        }

    cout << "Отрицательных элементов: " << negCount << endl;
    cout << "Максимум: " << maxVal << " (строка " << maxRow + 1
         << ", столбец " << maxCol + 1 << ")" << endl;
    return 0;
}
